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
  id_proveedor: entero('Elige el proveedor', 1).nullish(),
  cantidad: z.number({ error: 'Ingresa una cantidad válida' }),
  costo_unitario_clp: entero('El precio unitario debe ser un número válido', 0, 100_000_000)
});

router.get('/', async (req, res) => {
  const desde = fechaQuery(req.query.desde, 'desde');
  const hasta = fechaQuery(req.query.hasta, 'hasta');
  const idProducto = Number(req.query.id_producto) || null;
  const idProveedor = Number(req.query.id_proveedor) || null;
  const { page, pageSize, offset } = paginacion(req.query);
  const filtro = `WHERE ($2::date IS NULL OR (c.fecha_hora AT TIME ZONE $1)::date >= $2::date)
                    AND ($3::date IS NULL OR (c.fecha_hora AT TIME ZONE $1)::date <= $3::date)
                    AND ($4::bigint IS NULL OR c.id_producto = $4)
                    AND ($5::bigint IS NULL OR c.id_proveedor = $5)`;
  const params = [config.tz, desde, hasta, idProducto, idProveedor];
  const [lista, total] = await Promise.all([
    db.query(
      `SELECT c.id_compra, c.fecha_hora, c.id_producto, p.nombre AS producto, p.unidad, c.id_proveedor, pr.nombre AS proveedor,
              c.cantidad::float AS cantidad, c.costo_unitario_clp, c.costo_total_clp, u.nombre AS usuario
         FROM compras c JOIN productos p ON p.id_producto = c.id_producto JOIN proveedores pr ON pr.id_proveedor = c.id_proveedor
         JOIN usuarios u ON u.id_usuario = c.id_usuario
         ${filtro} ORDER BY c.fecha_hora DESC, c.id_compra DESC LIMIT $6 OFFSET $7`,
      [...params, pageSize, offset]
    ),
    db.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(c.costo_total_clp), 0)::bigint AS total_clp FROM compras c ${filtro}`, params)
  ]);
  res.json({ data: lista.rows, total: total.rows[0].n, total_clp: total.rows[0].total_clp, page, pageSize });
});

/**
 * RF-02: registra la recepción de mercadería y aumenta el stock en una sola transacción. El proveedor propuesto es
 * el habitual del producto y puede cambiarse si la mercadería llega de otro proveedor activo.
 */
router.post('/', requireRole('administrador', 'operador'), async (req, res) => {
  const b = parse(schema, req.body);
  const fecha = resolverFecha(b.fecha_hora);
  const r = await withTransaction(async (client) => {
    const p = await productoParaMovimiento(client, b.id_producto);
    const cantidad = validarCantidad(b.cantidad, p.unidad);
    const idProveedor = b.id_proveedor ?? p.id_proveedor;
    const prov = await client.query('SELECT nombre, activo FROM proveedores WHERE id_proveedor = $1', [idProveedor]);
    if (!prov.rowCount) throw errorCampo('id_proveedor', 'El proveedor no existe');
    if (!prov.rows[0].activo) throw errorCampo('id_proveedor', 'El proveedor está inactivo');
    const total = Math.round(cantidad * b.costo_unitario_clp);
    const nuevoStock = redondear2(p.stock_actual + cantidad);
    if (nuevoStock > 99_999_999) throw errorCampo('cantidad', 'La cantidad es demasiado grande');
    await client.query('UPDATE productos SET stock_actual = $2 WHERE id_producto = $1', [p.id_producto, nuevoStock]);
    const ins = await client.query(
      `INSERT INTO compras (id_producto, id_proveedor, id_usuario, fecha_hora, cantidad, costo_unitario_clp, costo_total_clp)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_compra, fecha_hora`,
      [p.id_producto, idProveedor, req.user.id, fecha, cantidad, b.costo_unitario_clp, total]
    );
    return { p, cantidad, total, nuevoStock, proveedor: prov.rows[0].nombre, idProveedor, compra: ins.rows[0] };
  });
  const evaluacion = await evaluarSinFallar([b.id_producto]);
  res.status(201).json({
    data: {
      id_compra: r.compra.id_compra,
      fecha_hora: r.compra.fecha_hora,
      id_producto: r.p.id_producto,
      producto: r.p.nombre,
      unidad: r.p.unidad,
      id_proveedor: r.idProveedor,
      proveedor: r.proveedor,
      cantidad: r.cantidad,
      costo_unitario_clp: b.costo_unitario_clp,
      costo_total_clp: r.total,
      stock_anterior: r.p.stock_actual,
      stock_nuevo: r.nuevoStock,
      nivel: evaluacion ? evaluacion.nivel : null
    }
  });
});

module.exports = router;
