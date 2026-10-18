const { Router } = require('express');
const config = require('../config');
const db = require('../db');
const { enviarCsv } = require('../lib/csv');
const { addDays, fechaHoraLocal, finMes, hoy, inicioMes, inicioSemana } = require('../lib/dates');
const { errorCampo, fechaQuery, paginacion } = require('../lib/http');

const router = Router();

function rango(query) {
  const hoyIso = hoy();
  const desde = fechaQuery(query.desde, 'desde') || inicioMes(hoyIso);
  const hasta = fechaQuery(query.hasta, 'hasta') || finMes(hoyIso);
  if (desde > hasta) throw errorCampo('hasta', 'La fecha final no puede ser anterior a la inicial');
  const tipo = ['ventas', 'compras', 'mermas'].includes(query.tipo) ? query.tipo : 'todos';
  return { desde, hasta, tipo };
}

const MOVIMIENTOS = `
  SELECT * FROM (
    SELECT v.fecha_hora, 'venta'::text AS tipo, v.id_producto, p.nombre AS producto, p.unidad, v.cantidad::float AS cantidad,
           v.total_clp AS monto_clp, u.nombre AS usuario, NULL::text AS proveedor
      FROM ventas v JOIN productos p ON p.id_producto = v.id_producto JOIN usuarios u ON u.id_usuario = v.id_usuario
     WHERE (v.fecha_hora AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
    UNION ALL
    SELECT c.fecha_hora, 'compra', c.id_producto, p.nombre, p.unidad, c.cantidad::float, c.costo_total_clp, u.nombre, pr.nombre
      FROM compras c JOIN productos p ON p.id_producto = c.id_producto JOIN usuarios u ON u.id_usuario = c.id_usuario
      JOIN proveedores pr ON pr.id_proveedor = c.id_proveedor
     WHERE (c.fecha_hora AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
    UNION ALL
    SELECT m.fecha_hora, 'merma', m.id_producto, p.nombre, p.unidad, m.cantidad::float, m.costo_total_clp, u.nombre, m.motivo
      FROM mermas m JOIN productos p ON p.id_producto = m.id_producto JOIN usuarios u ON u.id_usuario = m.id_usuario
     WHERE (m.fecha_hora AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
  ) m
  WHERE ($4 = 'todos' OR ($4 = 'ventas' AND m.tipo = 'venta') OR ($4 = 'compras' AND m.tipo = 'compra') OR ($4 = 'mermas' AND m.tipo = 'merma'))`;

/** Historial y reportes: totales del período, movimientos paginados y ventas de las últimas 6 semanas. */
router.get('/', async (req, res) => {
  const { desde, hasta, tipo } = rango(req.query);
  const { page, pageSize, offset } = paginacion(req.query, 25, 100);
  const hoyIso = hoy();
  const lunes6 = addDays(inicioSemana(hoyIso), -7 * 5);
  const [totales, lista, total, semanas] = await Promise.all([
    db.query(
      `SELECT
         (SELECT COALESCE(SUM(costo_total_clp), 0)::bigint FROM compras WHERE (fecha_hora AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS compras_clp,
         (SELECT COUNT(*)::int FROM compras WHERE (fecha_hora AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS compras_n,
         (SELECT COALESCE(SUM(total_clp), 0)::bigint FROM ventas WHERE (fecha_hora AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS ventas_clp,
         (SELECT COUNT(*)::int FROM ventas WHERE (fecha_hora AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS ventas_n,
         (SELECT COALESCE(SUM(v.cantidad), 0)::float FROM ventas v JOIN productos p ON p.id_producto = v.id_producto
           WHERE p.unidad = 'kg' AND (v.fecha_hora AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS ventas_kg,
         (SELECT COUNT(DISTINCT id_producto)::int FROM ventas WHERE (fecha_hora AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS productos_con_ventas,
         (SELECT COUNT(*)::int FROM productos WHERE activo) AS productos_activos,
         (SELECT COALESCE(SUM(cantidad), 0)::float FROM mermas WHERE (fecha_hora AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS mermas_kg,
         (SELECT COALESCE(SUM(costo_total_clp), 0)::bigint FROM mermas WHERE (fecha_hora AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS mermas_clp`,
      [config.tz, desde, hasta]
    ),
    db.query(`${MOVIMIENTOS} ORDER BY m.fecha_hora DESC LIMIT $5 OFFSET $6`, [config.tz, desde, hasta, tipo, pageSize, offset]),
    db.query(`SELECT COUNT(*)::int AS n FROM (${MOVIMIENTOS}) t`, [config.tz, desde, hasta, tipo]),
    db.query(
      `SELECT to_char(s::date, 'YYYY-MM-DD') AS semana,
              COALESCE((SELECT SUM(total_clp) FROM ventas WHERE date_trunc('week', fecha_hora AT TIME ZONE $1)::date = s::date), 0)::bigint AS ventas_clp,
              COALESCE((SELECT SUM(cantidad) FROM ventas v JOIN productos p ON p.id_producto = v.id_producto
                         WHERE p.unidad = 'kg' AND date_trunc('week', v.fecha_hora AT TIME ZONE $1)::date = s::date), 0)::float AS ventas_kg
         FROM generate_series($2::date, $3::date, interval '7 days') s ORDER BY s`,
      [config.tz, lunes6, inicioSemana(hoyIso)]
    )
  ]);
  res.json({ desde, hasta, tipo, totales: totales.rows[0], movimientos: lista.rows, total: total.rows[0].n, page, pageSize, semanas: semanas.rows });
});

router.get('/export.csv', async (req, res) => {
  const { desde, hasta, tipo } = rango(req.query);
  const { rows } = await db.query(`${MOVIMIENTOS} ORDER BY m.fecha_hora DESC LIMIT 50000`, [config.tz, desde, hasta, tipo]);
  enviarCsv(res, `historial-${desde}_a_${hasta}.csv`, [
    { titulo: 'Fecha y hora', valor: (m) => fechaHoraLocal(m.fecha_hora) },
    { titulo: 'Tipo', valor: (m) => ({ venta: 'Venta', compra: 'Compra', merma: 'Merma' })[m.tipo] },
    { titulo: 'Producto', valor: (m) => m.producto },
    { titulo: 'Cantidad', valor: (m) => m.cantidad },
    { titulo: 'Unidad', valor: (m) => m.unidad },
    { titulo: 'Monto (CLP)', valor: (m) => m.monto_clp },
    { titulo: 'Proveedor o motivo', valor: (m) => m.proveedor },
    { titulo: 'Registrado por', valor: (m) => m.usuario }
  ], rows);
});

module.exports = router;
