const { Router } = require('express');
const { z } = require('zod');
const config = require('../config');
const db = require('../db');
const { addDays, hoy } = require('../lib/dates');
const { parse } = require('../lib/errors');
const { entero, errorCampo } = require('../lib/http');
const { requireRole } = require('../middleware/auth');
const { calcularRiesgos, registrarPrediccion } = require('../services/alertas');
const { eventosEnRango } = require('../services/eventos');
const { snapshotInventario } = require('../services/inventario');
const { DIAS, modeloActivo, modeloDisponible, predecirConModelo } = require('../services/prediccion');
const { promedioHistorico } = require('../services/demanda');
const { withTransaction } = require('../lib/tx');

const router = Router();

/**
 * Pantalla «Predicción de demanda y alertas»: demanda proyectada a 7 días por producto con su stock, kilos
 * sugeridos, proveedor, fecha límite y nivel. Filtro opcional por categoría.
 */
router.get('/resumen', async (req, res) => {
  const idCat = Number(req.query.categoria) || null;
  const hoyIso = hoy();
  const inventario = (await snapshotInventario()).filter((p) => !idCat || p.id_categoria === idCat);
  const sugerencias = new Map(calcularRiesgos(inventario, hoyIso).map((s) => [s.id_producto, s]));
  const [activo, disponible] = await Promise.all([modeloActivo(), modeloDisponible().catch(() => null)]);
  const productos = inventario
    .map((p) => {
      const s = sugerencias.get(p.id_producto);
      return {
        id_producto: p.id_producto,
        producto: p.nombre,
        categoria: p.categoria,
        unidad: p.unidad,
        nivel: p.nivel,
        demanda_7d: p.demanda_semana,
        origen_demanda: p.origen_demanda,
        stock_actual: p.stock_actual,
        cantidad_sugerida: s ? s.cantidad_sugerida : null,
        proveedor: p.proveedor,
        fecha_limite_pedido: s ? s.fecha_limite_pedido : null
      };
    })
    .sort((a, b) => ({ quiebre: 0, bajo: 1, optimo: 2 })[a.nivel] - ({ quiebre: 0, bajo: 1, optimo: 2 })[b.nivel] || (a.fecha_limite_pedido || '9').localeCompare(b.fecha_limite_pedido || '9') || a.producto.localeCompare(b.producto));
  res.json({
    hoy: hoyIso,
    motor: {
      estado: disponible ? 'modelo' : 'respaldo',
      modelo: activo ? { algoritmo: activo.algoritmo, version: activo.version } : null,
      motivo: disponible ? null : activo ? 'El motor de predicción no está disponible: se usa el promedio histórico.' : 'Aún no hay un modelo activo: se usa el promedio histórico.'
    },
    productos
  });
});

/** Serie diaria de un producto: histórico (kg/día), proyección de los próximos 7 días y eventos del calendario. */
router.get('/producto/:id/serie', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw errorCampo('id', 'Identificador inválido');
  const dias = Math.min(90, Math.max(7, parseInt(req.query.dias, 10) || 30));
  const hoyIso = hoy();
  const [snap] = await snapshotInventario([id]);
  if (!snap) throw errorCampo('id', 'El producto no existe o está inactivo', 404);
  const hist = await db.query(
    `SELECT to_char(d::date, 'YYYY-MM-DD') AS fecha,
            COALESCE((SELECT SUM(cantidad) FROM ventas WHERE id_producto = $1 AND (fecha_hora AT TIME ZONE $2)::date = d::date), 0)::float AS kg
       FROM generate_series($3::date - $4::int, $3::date, interval '1 day') d ORDER BY d`,
    [id, config.tz, hoyIso, dias - 1]
  );
  const diaria = Math.round((snap.demanda_semana / 7) * 100) / 100;
  const prediccion = Array.from({ length: 7 }, (_, i) => ({ fecha: addDays(hoyIso, i + 1), kg: diaria }));
  const eventos = await eventosEnRango(addDays(hoyIso, -(dias - 1)), addDays(hoyIso, 7));
  res.json({
    data: {
      id_producto: id,
      producto: snap.nombre,
      unidad: snap.unidad,
      hoy: hoyIso,
      origen_demanda: snap.origen_demanda,
      historico: hist.rows,
      prediccion,
      eventos: eventos.filter((e) => e.tipo !== 'quincena' && e.tipo !== 'fin_de_mes')
    }
  });
});

const generarSchema = z.object({ id_producto: entero('Elige un producto', 1), horizonte: z.enum(['semana', 'mes'], { error: 'El horizonte es semana o mes' }).default('semana') });

/**
 * RF-08: genera la predicción de un producto. Usa el modelo activo si responde en menos de 2 s; si no, aplica el
 * respaldo (RF-11). Registra el resultado con su origen y latencia (RF-10). No muestra detalles técnicos.
 */
router.post('/generar', requireRole('administrador', 'ti'), async (req, res) => {
  const { id_producto, horizonte } = parse(generarSchema, req.body);
  const info = await db.query(
    `SELECT p.id_producto, p.nombre, p.unidad, c.nombre AS categoria FROM productos p JOIN categorias c ON c.id_categoria = p.id_categoria
      WHERE p.id_producto = $1 AND p.activo`,
    [id_producto]
  );
  if (!info.rowCount) throw errorCampo('id_producto', 'El producto no existe o está inactivo');
  const producto = info.rows[0];
  let resultado = null;
  let respaldo = false;
  try {
    const modelo = await modeloDisponible();
    if (modelo) resultado = await predecirConModelo(producto, horizonte, modelo);
    else respaldo = true;
  } catch (e) {
    console.warn(`[predicción] se usa el respaldo para el producto ${id_producto}: ${e.message}`);
    respaldo = true;
  }
  if (!resultado) {
    const m = await promedioHistorico.estimar([id_producto], horizonte);
    resultado = { ...m.get(id_producto), id_modelo: null, latencia_ms: null };
  }
  const id = await withTransaction((client) =>
    registrarPrediccion(client, {
      id_producto,
      id_modelo: resultado.id_modelo,
      horizonte,
      demanda: resultado.demanda,
      origen: resultado.origen,
      latencia_ms: resultado.latencia_ms
    })
  );
  res.status(201).json({
    data: { id_prediccion: id, id_producto, horizonte, dias: DIAS[horizonte], demanda: resultado.demanda, unidad: producto.unidad, origen: resultado.origen, respaldo, latencia_ms: resultado.latencia_ms }
  });
});

module.exports = router;
