const { Router } = require('express');
const { z } = require('zod');
const config = require('../config');
const db = require('../db');
const { fechaQuery, entero, errorCampo, paginacion, redondear2 } = require('../lib/http');
const { baseSchema, productoParaMovimiento, resolverFecha, validarCantidad } = require('../lib/movimientos');
const { parse } = require('../lib/errors');
const { withTransaction } = require('../lib/tx');
const { requireRole } = require('../middleware/auth');
const { evaluarSinFallar } = require('../services/alertas');

const router = Router();

const schema = z.object({
  ...baseSchema,
  cantidad: z.number({ error: 'Ingresa una cantidad válida' }),
  precio_unitario_clp: entero('El precio debe ser un número válido', 0, 100_000_000).nullish()
});

/** Ventas con filtros por fecha y producto (más recientes primero). */
router.get('/', async (req, res) => {
  const desde = fechaQuery(req.query.desde, 'desde');
  const hasta = fechaQuery(req.query.hasta, 'hasta');
  const idProducto = Number(req.query.id_producto) || null;
  const { page, pageSize, offset } = paginacion(req.query);
  const filtro = `WHERE ($2::date IS NULL OR (v.fecha_hora AT TIME ZONE $1)::date >= $2::date)
                    AND ($3::date IS NULL OR (v.fecha_hora AT TIME ZONE $1)::date <= $3::date)
                    AND ($4::bigint IS NULL OR v.id_producto = $4)`;
  const params = [config.tz, desde, hasta, idProducto];
  const [lista, total] = await Promise.all([
    db.query(
      `SELECT v.id_venta, v.fecha_hora, v.id_producto, p.nombre AS producto, p.unidad, v.cantidad::float AS cantidad,
              v.precio_unitario_clp, v.total_clp, u.nombre AS usuario
         FROM ventas v JOIN productos p ON p.id_producto = v.id_producto JOIN usuarios u ON u.id_usuario = v.id_usuario
         ${filtro} ORDER BY v.fecha_hora DESC, v.id_venta DESC LIMIT $5 OFFSET $6`,
      [...params, pageSize, offset]
    ),
    db.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(v.total_clp), 0)::bigint AS total_clp FROM ventas v ${filtro}`, params)
  ]);
  res.json({ data: lista.rows, total: total.rows[0].n, total_clp: total.rows[0].total_clp, page, pageSize });
});

/**
 * RF-01: registra la venta y descuenta el stock en una sola transacción. El precio se precarga desde el catálogo
 * y la API recalcula el total (cantidad × precio). Rechaza cantidades inválidas o superiores al stock disponible.
 */
router.post('/', requireRole('administrador', 'operador'), async (req, res) => {
  const b = parse(schema, req.body);
  const fecha = resolverFecha(b.fecha_hora);
  const r = await withTransaction(async (client) => {
    const p = await productoParaMovimiento(client, b.id_producto);
    const cantidad = validarCantidad(b.cantidad, p.unidad);
    if (cantidad > p.stock_actual + 1e-9) {
      throw errorCampo('cantidad', `La cantidad supera el stock disponible (${p.stock_actual} ${p.unidad}).`, 409);
    }
    const precio = b.precio_unitario_clp ?? p.precio_venta_clp;
    const total = Math.round(cantidad * precio);
    const nuevoStock = redondear2(p.stock_actual - cantidad);
    await client.query('UPDATE productos SET stock_actual = $2 WHERE id_producto = $1', [p.id_producto, nuevoStock]);
    const ins = await client.query(
      `INSERT INTO ventas (id_producto, id_usuario, fecha_hora, cantidad, precio_unitario_clp, total_clp)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_venta, fecha_hora`,
      [p.id_producto, req.user.id, fecha, cantidad, precio, total]
    );
    return { p, cantidad, precio, total, nuevoStock, venta: ins.rows[0] };
  });
  const evaluacion = await evaluarSinFallar([b.id_producto]);
  res.status(201).json({
    data: {
      id_venta: r.venta.id_venta,
      fecha_hora: r.venta.fecha_hora,
      id_producto: r.p.id_producto,
      producto: r.p.nombre,
      unidad: r.p.unidad,
      cantidad: r.cantidad,
      precio_unitario_clp: r.precio,
      total_clp: r.total,
      stock_anterior: r.p.stock_actual,
      stock_nuevo: r.nuevoStock,
      stock_minimo: r.p.stock_minimo,
      nivel: evaluacion ? evaluacion.nivel : null,
      alerta_generada: !!(evaluacion && evaluacion.alerta)
    }
  });
});

module.exports = router;
