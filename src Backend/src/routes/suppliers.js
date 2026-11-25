const { Router } = require('express');
const { z } = require('zod');
const config = require('../config');
const db = require('../db');
const { addDays, hoy } = require('../lib/dates');
const { ApiError, parse } = require('../lib/errors');
const { entero, errorCampo, idParam, validarNombreUnico } = require('../lib/http');
const { requireRole } = require('../middleware/auth');
const { evaluarSinFallar } = require('../services/alertas');

const router = Router();
const catalogo = requireRole('administrador', 'ti');

const schema = z.object({
  nombre: z.string({ error: 'Ingresa el nombre' }).trim().min(2, 'Ingresa el nombre').max(120, 'Máximo 120 caracteres'),
  contacto: z.string().trim().max(160, 'Máximo 160 caracteres').nullish().transform((v) => v || null),
  lead_time_dias: entero('El lead time debe ser un número de días (0 o más)', 0, 365),
  dias_habiles: z
    .array(entero('Día inválido', 1, 7), { error: 'Elige al menos un día hábil' })
    .min(1, 'Elige al menos un día hábil de atención')
    .transform((d) => [...new Set(d)].sort((a, b) => a - b))
});

const duplicado = (e) => (e.code === '23505' ? errorCampo('nombre', 'Ya existe un proveedor con ese nombre') : e);

/**
 * Proveedores con productos activos y compras de los últimos 30 días hasta «hoy» (respeta FECHA_REFERENCIA).
 * `n` es el número del primer parámetro SQL libre: se agregan dos (primer día de la ventana y zona horaria).
 */
const SELECT_DESDE = (n) => `
  SELECT pr.id_proveedor, pr.nombre, pr.contacto, pr.lead_time_dias, pr.dias_habiles, pr.activo,
         (SELECT COUNT(*)::int FROM productos p WHERE p.id_proveedor = pr.id_proveedor AND p.activo) AS productos,
         COALESCE((SELECT SUM(c.costo_total_clp) FROM compras c
                    WHERE c.id_proveedor = pr.id_proveedor AND c.fecha_hora >= ($${n}::date::timestamp AT TIME ZONE $${n + 1})
                      AND c.fecha_hora < (($${n}::date + 30)::timestamp AT TIME ZONE $${n + 1})), 0)::bigint AS compras_30d_clp
    FROM proveedores pr`;
const ventana = () => [addDays(hoy(), -29), config.tz];

/** Proveedores con su lead time, días hábiles, productos y compras de los últimos 30 días. ?todos=1 incluye inactivos. */
router.get('/', async (req, res) => {
  const { rows } = await db.query(`${SELECT_DESDE(2)} WHERE ($1::boolean OR pr.activo) ORDER BY pr.activo DESC, pr.nombre`, [req.query.todos === '1', ...ventana()]);
  res.json({ data: rows });
});

router.post('/', catalogo, async (req, res) => {
  const b = parse(schema, req.body);
  await validarNombreUnico(db, 'proveedores', b.nombre);
  try {
    const { rows } = await db.query(
      'INSERT INTO proveedores (nombre, contacto, lead_time_dias, dias_habiles) VALUES ($1, $2, $3, $4) RETURNING id_proveedor',
      [b.nombre, b.contacto, b.lead_time_dias, b.dias_habiles]
    );
    res.status(201).json({ data: (await db.query(`${SELECT_DESDE(2)} WHERE pr.id_proveedor = $1`, [rows[0].id_proveedor, ...ventana()])).rows[0] });
  } catch (e) {
    throw duplicado(e);
  }
});

router.put('/:id', catalogo, async (req, res) => {
  const id = idParam(req);
  const b = parse(schema, req.body);
  await validarNombreUnico(db, 'proveedores', b.nombre, id);
  try {
    const r = await db.query(
      'UPDATE proveedores SET nombre = $2, contacto = $3, lead_time_dias = $4, dias_habiles = $5 WHERE id_proveedor = $1',
      [id, b.nombre, b.contacto, b.lead_time_dias, b.dias_habiles]
    );
    if (!r.rowCount) throw new ApiError(404, 'no_encontrado', 'El proveedor no existe');
  } catch (e) {
    throw duplicado(e);
  }
  // el lead time y los días hábiles cambian las fechas límite de pedido de sus productos
  const prods = await db.query('SELECT id_producto FROM productos WHERE id_proveedor = $1 AND activo', [id]);
  if (prods.rowCount) void evaluarSinFallar(prods.rows.map((p) => p.id_producto));
  res.json({ data: (await db.query(`${SELECT_DESDE(2)} WHERE pr.id_proveedor = $1`, [id, ...ventana()])).rows[0] });
});

/** Baja lógica: un proveedor con productos activos no puede desactivarse hasta reasignarlos. */
router.patch('/:id/estado', catalogo, async (req, res) => {
  const id = idParam(req);
  const { activo } = parse(z.object({ activo: z.boolean({ error: 'Indica si el proveedor está activo' }) }), req.body);
  if (!activo) {
    const n = (await db.query('SELECT COUNT(*)::int AS n FROM productos WHERE id_proveedor = $1 AND activo', [id])).rows[0].n;
    if (n > 0) throw new ApiError(409, 'tiene_productos', 'El proveedor es el habitual de productos activos. Cambia el proveedor de esos productos antes de desactivarlo.');
  }
  const r = await db.query('UPDATE proveedores SET activo = $2 WHERE id_proveedor = $1', [id, activo]);
  if (!r.rowCount) throw new ApiError(404, 'no_encontrado', 'El proveedor no existe');
  res.json({ data: (await db.query(`${SELECT_DESDE(2)} WHERE pr.id_proveedor = $1`, [id, ...ventana()])).rows[0] });
});

/** RNF-10: con compras o productos históricos no se elimina; se ofrece la baja lógica. */
router.delete('/:id', catalogo, async (req, res) => {
  const id = idParam(req);
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM compras WHERE id_proveedor = $1) +
            (SELECT COUNT(*)::int FROM productos WHERE id_proveedor = $1) +
            (SELECT COUNT(*)::int FROM alertas_inventario WHERE id_proveedor = $1) AS n`,
    [id]
  );
  if (rows[0].n > 0) {
    throw new ApiError(409, 'tiene_historial', 'El proveedor tiene productos o compras registradas, por lo que no se puede eliminar. Puedes desactivarlo (baja lógica).');
  }
  const r = await db.query('DELETE FROM proveedores WHERE id_proveedor = $1', [id]);
  if (!r.rowCount) throw new ApiError(404, 'no_encontrado', 'El proveedor no existe');
  res.status(204).end();
});

module.exports = router;
