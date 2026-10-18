const { Router } = require('express');
const { z } = require('zod');
const db = require('../db');
const { addDays, esFechaIso, hoy } = require('../lib/dates');
const { ApiError, parse } = require('../lib/errors');
const { errorCampo, idParam } = require('../lib/http');
const { withTransaction } = require('../lib/tx');
const { requireRole } = require('../middleware/auth');
const { maeRespaldo } = require('../services/precision');
const { artefactoExiste, modeloDisponible } = require('../services/prediccion');
const { snapshotInventario } = require('../services/inventario');

const router = Router();
const ver = requireRole('administrador', 'ti');
const gestionar = requireRole('ti');

const fecha = (msg) => z.string({ error: msg }).refine(esFechaIso, msg);
const mae = (msg) => z.number({ error: msg }).min(0, msg).max(100000, msg);

const schema = z
  .object({
    algoritmo: z.string({ error: 'Ingresa el algoritmo' }).trim().min(2, 'Ingresa el algoritmo').max(60, 'Máximo 60 caracteres'),
    version: z.string({ error: 'Ingresa la versión' }).trim().min(1, 'Ingresa la versión').max(20, 'Máximo 20 caracteres'),
    mae_general: mae('El MAE general debe ser un número de 0 o más'),
    mae_festivos: mae('El MAE en festivos debe ser un número de 0 o más').nullish().transform((v) => v ?? null),
    entrenado_desde: fecha('Fecha de inicio de entrenamiento inválida'),
    entrenado_hasta: fecha('Fecha de término de entrenamiento inválida'),
    prueba_desde: fecha('Fecha de inicio de prueba inválida'),
    prueba_hasta: fecha('Fecha de término de prueba inválida'),
    artefacto_ruta: z.string({ error: 'Ingresa la ruta del artefacto' }).trim().min(3, 'Ingresa la ruta del artefacto').max(200, 'Máximo 200 caracteres')
  })
  .superRefine((m, ctx) => {
    if (m.entrenado_hasta < m.entrenado_desde) ctx.addIssue({ code: 'custom', path: ['entrenado_hasta'], message: 'Debe ser posterior al inicio del entrenamiento' });
    if (m.prueba_hasta < m.prueba_desde) ctx.addIssue({ code: 'custom', path: ['prueba_hasta'], message: 'Debe ser posterior al inicio de la prueba' });
  });

const SELECT = `
  SELECT id_modelo, algoritmo, version, mae_general::float AS mae_general, mae_festivos::float AS mae_festivos,
         to_char(entrenado_desde, 'YYYY-MM-DD') AS entrenado_desde, to_char(entrenado_hasta, 'YYYY-MM-DD') AS entrenado_hasta,
         to_char(prueba_desde, 'YYYY-MM-DD') AS prueba_desde, to_char(prueba_hasta, 'YYYY-MM-DD') AS prueba_hasta,
         artefacto_ruta, activo, creado_en
    FROM modelos_ml`;

/**
 * «Precisión del modelo»: modelo activo, versiones registradas, línea base del respaldo (promedio histórico, calculada con
 * ventas reales en la ventana de prueba del modelo o, si no hay datos, en las últimas 8 semanas), latencia del motor y
 * origen de la proyección de cada producto.
 */
router.get('/', ver, async (_req, res) => {
  const { rows: modelos } = await db.query(`${SELECT} ORDER BY activo DESC, creado_en DESC`);
  const activo = modelos.find((m) => m.activo) || null;
  const hoyIso = hoy();

  let base = null;
  let baseVentana = null;
  if (activo) {
    base = await maeRespaldo(activo.prueba_desde, activo.prueba_hasta);
    if (base) baseVentana = { desde: activo.prueba_desde, hasta: activo.prueba_hasta, tipo: 'prueba' };
  }
  const reciente = await maeRespaldo(addDays(hoyIso, -56), hoyIso);
  if (!base && reciente) {
    base = reciente;
    baseVentana = { desde: addDays(hoyIso, -56), hasta: hoyIso, tipo: 'reciente' };
  }

  const [lat, inventario, disponible] = await Promise.all([
    db.query(`SELECT AVG(latencia_ms)::float AS promedio, MAX(latencia_ms) AS maximo, COUNT(*)::int AS n
                FROM (SELECT latencia_ms FROM predicciones WHERE origen = 'modelo' AND latencia_ms IS NOT NULL ORDER BY generada_en DESC LIMIT 200) t`),
    snapshotInventario(),
    modeloDisponible().catch(() => null)
  ]);
  const porProducto = inventario.map((p) => ({
    id_producto: p.id_producto,
    producto: p.nombre,
    unidad: p.unidad,
    origen: p.origen_demanda,
    mae_respaldo: reciente && reciente.productos.has(p.id_producto) ? Math.round(reciente.productos.get(p.id_producto) * 1000) / 1000 : null,
    sin_historial: p.origen_demanda === 'categoria'
  }));

  res.json({
    data: {
      activo,
      modelos,
      motor: { disponible: !!disponible, limite_ms: 2000, latencia_promedio_ms: lat.rows[0].promedio, latencia_maxima_ms: lat.rows[0].maximo, predicciones_con_modelo: lat.rows[0].n },
      base: base && { mae_general: base.mae_general, mae_festivos: base.mae_festivos, observaciones: base.observaciones, ventana: baseVentana },
      mejora_general_pct: activo && base && base.mae_general > 0 ? Math.round((1 - activo.mae_general / base.mae_general) * 100) : null,
      productos: porProducto
    }
  });
});

/** RF-06: registra una versión del modelo (queda inactiva). Verifica que el artefacto exista en ml-engine. */
router.post('/', gestionar, async (req, res) => {
  const b = parse(schema, req.body);
  if (!artefactoExiste(b.artefacto_ruta)) {
    throw errorCampo('artefacto_ruta', 'No se encontró el artefacto en esa ruta (se busca dentro de la carpeta ml-engine del servidor).');
  }
  const { rows } = await db.query(
    `INSERT INTO modelos_ml (algoritmo, version, mae_general, mae_festivos, entrenado_desde, entrenado_hasta, prueba_desde, prueba_hasta, artefacto_ruta, activo)
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7::date, $8::date, $9, FALSE) RETURNING id_modelo`,
    [b.algoritmo, b.version, b.mae_general, b.mae_festivos, b.entrenado_desde, b.entrenado_hasta, b.prueba_desde, b.prueba_hasta, b.artefacto_ruta]
  );
  res.status(201).json({ data: (await db.query(`${SELECT} WHERE id_modelo = $1`, [rows[0].id_modelo])).rows[0] });
});

/**
 * Activa una versión y desactiva la anterior (un único modelo activo). Si su MAE no mejora al del modelo activo
 * se exige confirmación expresa (`confirmar: true`).
 */
router.patch('/:id/activar', gestionar, async (req, res) => {
  const id = idParam(req);
  const { confirmar } = parse(z.object({ confirmar: z.boolean().optional() }), req.body || {});
  await withTransaction(async (client) => {
    const nuevo = (await client.query('SELECT id_modelo, mae_general::float AS mae_general, activo FROM modelos_ml WHERE id_modelo = $1 FOR UPDATE', [id])).rows[0];
    if (!nuevo) throw new ApiError(404, 'no_encontrado', 'El modelo no existe');
    if (nuevo.activo) return;
    const actual = (await client.query('SELECT mae_general::float AS mae_general, algoritmo, version FROM modelos_ml WHERE activo FOR UPDATE')).rows[0];
    if (actual && nuevo.mae_general > actual.mae_general && !confirmar) {
      throw new ApiError(409, 'requiere_confirmacion', `El MAE de esta versión (${nuevo.mae_general} kg) es mayor que el del modelo activo (${actual.mae_general} kg). Confirma para activarla de todos modos.`);
    }
    await client.query('UPDATE modelos_ml SET activo = FALSE WHERE activo');
    await client.query('UPDATE modelos_ml SET activo = TRUE WHERE id_modelo = $1', [id]);
  });
  res.json({ data: (await db.query(`${SELECT} WHERE id_modelo = $1`, [id])).rows[0] });
});

module.exports = router;
