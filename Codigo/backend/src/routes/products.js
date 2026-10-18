const { Router } = require('express');
const { z } = require('zod');
const config = require('../config');
const db = require('../db');
const { enviarCsv } = require('../lib/csv');
const { fechaHoraLocal, hoy } = require('../lib/dates');
const { ApiError, parse } = require('../lib/errors');
const { entero, errorCampo, idParam, redondear2, validarNombreUnico } = require('../lib/http');
const { withTransaction } = require('../lib/tx');
const { requireRole } = require('../middleware/auth');
const { evaluarSinFallar, sugerenciaDe } = require('../services/alertas');
const { snapshotInventario } = require('../services/inventario');

const router = Router();
const catalogo = requireRole('administrador', 'ti');

const numero = (msg, min = 0, max = 1_000_000) => z.number({ error: msg }).min(min, msg).max(max, msg);

const schema = z.object({
  nombre: z.string({ error: 'Ingresa el nombre del producto' }).trim().min(2, 'Ingresa el nombre del producto').max(120, 'Máximo 120 caracteres'),
  id_categoria: entero('Elige una categoría', 1),
  id_proveedor: entero('Elige el proveedor habitual', 1),
  unidad: z.enum(['kg', 'un'], { error: 'Elige la unidad de medida' }),
  precio_venta_clp: entero('El precio de venta debe ser un número válido', 0, 100_000_000),
  stock_minimo: numero('El stock mínimo debe ser 0 o más', 0, 100000).default(0),
  stock_inicial: numero('El stock inicial debe ser 0 o más', 0, 100000).default(0),
  vida_util_dias: entero('La vida útil debe ser un número de días mayor que 0', 1, 3650).nullish().transform((v) => v ?? null),
  margen_seguridad_pct: numero('El margen debe ser 0 o más', 0, 500).default(10)
});

/** Las unidades se registran enteras y los kilos con hasta 2 decimales. */
function normalizar(b, { conStockInicial }) {
  const r = { ...b, stock_minimo: redondear2(b.stock_minimo), margen_seguridad_pct: redondear2(b.margen_seguridad_pct) };
  if (conStockInicial) r.stock_inicial = redondear2(b.stock_inicial);
  if (b.unidad === 'un') {
    if (!Number.isInteger(r.stock_minimo)) throw errorCampo('stock_minimo', 'En unidades el stock debe ser un número entero');
    if (conStockInicial && !Number.isInteger(r.stock_inicial)) throw errorCampo('stock_inicial', 'En unidades el stock debe ser un número entero');
  }
  return r;
}

async function validarRelaciones(b) {
  const [c, p] = await Promise.all([
    db.query('SELECT 1 FROM categorias WHERE id_categoria = $1', [b.id_categoria]),
    db.query('SELECT activo FROM proveedores WHERE id_proveedor = $1', [b.id_proveedor])
  ]);
  if (!c.rowCount) throw errorCampo('id_categoria', 'La categoría no existe');
  if (!p.rowCount) throw errorCampo('id_proveedor', 'El proveedor no existe');
  if (!p.rows[0].activo) throw errorCampo('id_proveedor', 'El proveedor está inactivo');
}

const mapearErrorBD = (e) => {
  if (e.code === '23505') return errorCampo('nombre', 'Ya existe un producto con ese nombre');
  if (e.code === '23503') return errorCampo('id_proveedor', 'La categoría o el proveedor ya no existen');
  return e;
};

const COLUMNAS = `
  p.id_producto, p.nombre, p.id_categoria, c.nombre AS categoria, p.id_proveedor, pr.nombre AS proveedor,
  p.unidad, p.precio_venta_clp, p.stock_actual, p.stock_minimo, p.vida_util_dias, p.margen_seguridad_pct, p.activo,
  pr.lead_time_dias,
  (SELECT MAX(fecha_hora) FROM compras WHERE id_producto = p.id_producto) AS ultima_compra,
  (SELECT MAX(fecha_hora) FROM ventas WHERE id_producto = p.id_producto) AS ultima_venta`;
const FROM = `FROM productos p JOIN categorias c ON c.id_categoria = p.id_categoria JOIN proveedores pr ON pr.id_proveedor = p.id_proveedor`;

async function listarProductos(query) {
  const estado = ['activos', 'inactivos', 'todos'].includes(query.estado) ? query.estado : 'activos';
  const [inventario, { rows }] = await Promise.all([
    snapshotInventario(),
    db.query(`SELECT ${COLUMNAS} ${FROM} WHERE ($1 = 'todos' OR p.activo = ($1 = 'activos')) ORDER BY p.nombre`, [estado])
  ]);
  const mapa = new Map(inventario.map((p) => [p.id_producto, p]));
  const q = String(query.q || '').trim().toLowerCase();
  const idCat = Number(query.categoria) || null;
  let data = rows.map((r) => {
    const i = mapa.get(r.id_producto);
    return {
      ...r,
      nivel: i ? i.nivel : null,
      demanda_semana: i ? i.demanda_semana : null,
      origen_demanda: i ? i.origen_demanda : null,
      dias_cobertura: i ? i.dias_cobertura : null
    };
  });
  if (q) data = data.filter((p) => p.nombre.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q) || p.proveedor.toLowerCase().includes(q));
  if (idCat) data = data.filter((p) => p.id_categoria === idCat);
  const resumen = { total: data.length, quiebre: 0, bajo: 0, optimo: 0 };
  for (const p of data) if (p.nivel) resumen[p.nivel]++;
  if (['quiebre', 'bajo', 'optimo'].includes(query.nivel)) data = data.filter((p) => p.nivel === query.nivel);
  return { data, resumen, actualizado_en: new Date().toISOString() };
}

router.get('/', async (req, res) => {
  res.json(await listarProductos(req.query));
});

router.get('/export.csv', async (req, res) => {
  const { data } = await listarProductos(req.query);
  enviarCsv(res, `inventario-${hoy()}.csv`, [
    { titulo: 'Producto', valor: (p) => p.nombre },
    { titulo: 'Categoría', valor: (p) => p.categoria },
    { titulo: 'Proveedor', valor: (p) => p.proveedor },
    { titulo: 'Unidad', valor: (p) => p.unidad },
    { titulo: 'Stock actual', valor: (p) => p.stock_actual },
    { titulo: 'Stock mínimo', valor: (p) => p.stock_minimo },
    { titulo: 'Estado', valor: (p) => ({ quiebre: 'Quiebre', bajo: 'Bajo', optimo: 'Óptimo' })[p.nivel] || 'Inactivo' },
    { titulo: 'Precio de venta (CLP)', valor: (p) => p.precio_venta_clp },
    { titulo: 'Última compra', valor: (p) => fechaHoraLocal(p.ultima_compra) },
    { titulo: 'Última venta', valor: (p) => fechaHoraLocal(p.ultima_venta) }
  ], data);
});

async function detalle(id) {
  const { rows } = await db.query(`SELECT ${COLUMNAS}, pr.dias_habiles ${FROM} WHERE p.id_producto = $1`, [id]);
  if (!rows.length) throw new ApiError(404, 'no_encontrado', 'El producto no existe');
  const p = rows[0];
  const hoyIso = hoy();
  const [snap, serie, movs] = await Promise.all([
    p.activo ? snapshotInventario([id]) : Promise.resolve([]),
    db.query(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS fecha,
              COALESCE((SELECT SUM(cantidad) FROM compras WHERE id_producto = $1 AND (fecha_hora AT TIME ZONE $2)::date = d::date), 0)::float AS compras,
              COALESCE((SELECT SUM(cantidad) FROM ventas  WHERE id_producto = $1 AND (fecha_hora AT TIME ZONE $2)::date = d::date), 0)::float AS ventas
         FROM generate_series($3::date - 29, $3::date, interval '1 day') d ORDER BY d`,
      [id, config.tz, hoyIso]
    ),
    db.query(
      `(SELECT v.fecha_hora, 'venta' AS tipo, v.cantidad::float AS cantidad, v.total_clp AS monto_clp, u.nombre AS usuario, NULL::text AS proveedor
          FROM ventas v JOIN usuarios u ON u.id_usuario = v.id_usuario WHERE v.id_producto = $1)
       UNION ALL
       (SELECT c.fecha_hora, 'compra', c.cantidad::float, c.costo_total_clp, u.nombre, pr.nombre
          FROM compras c JOIN usuarios u ON u.id_usuario = c.id_usuario JOIN proveedores pr ON pr.id_proveedor = c.id_proveedor WHERE c.id_producto = $1)
       ORDER BY fecha_hora DESC LIMIT 15`,
      [id]
    )
  ]);
  const i = snap[0];
  const sugerencia = i && i.nivel !== 'optimo' ? sugerenciaDe(i, hoyIso) : null;
  const { dias_habiles, ...resto } = p;
  return {
    ...resto,
    valor_stock_clp: Math.round(p.stock_actual * p.precio_venta_clp),
    nivel: i ? i.nivel : null,
    demanda_semana: i ? i.demanda_semana : null,
    origen_demanda: i ? i.origen_demanda : null,
    dias_cobertura: i ? i.dias_cobertura : null,
    sugerencia: sugerencia && {
      cantidad_sugerida: sugerencia.cantidad_sugerida,
      fecha_quiebre_estimada: sugerencia.fecha_quiebre_estimada,
      fecha_limite_pedido: sugerencia.fecha_limite_pedido
    },
    serie_30d: serie.rows,
    movimientos: movs.rows
  };
}

router.get('/:id', async (req, res) => {
  res.json({ data: await detalle(idParam(req)) });
});

router.post('/', catalogo, async (req, res) => {
  const b = normalizar(parse(schema, req.body), { conStockInicial: true });
  await validarRelaciones(b);
  await validarNombreUnico(db, 'productos', b.nombre);
  let id;
  try {
    const { rows } = await db.query(
      `INSERT INTO productos (nombre, id_categoria, id_proveedor, unidad, precio_venta_clp, stock_actual, stock_minimo, vida_util_dias, margen_seguridad_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id_producto`,
      [b.nombre, b.id_categoria, b.id_proveedor, b.unidad, b.precio_venta_clp, b.stock_inicial, b.stock_minimo, b.vida_util_dias, b.margen_seguridad_pct]
    );
    id = rows[0].id_producto;
  } catch (e) {
    throw mapearErrorBD(e);
  }
  await evaluarSinFallar([id]);
  res.status(201).json({ data: await detalle(id) });
});

/** Edita los datos del catálogo. El stock solo cambia con ventas y compras (trazabilidad). */
router.put('/:id', catalogo, async (req, res) => {
  const id = idParam(req);
  const b = normalizar(parse(schema.omit({ stock_inicial: true }), req.body), { conStockInicial: false });
  await validarRelaciones(b);
  await validarNombreUnico(db, 'productos', b.nombre, id);
  try {
    const r = await db.query(
      `UPDATE productos SET nombre = $2, id_categoria = $3, id_proveedor = $4, unidad = $5, precio_venta_clp = $6,
              stock_minimo = $7, vida_util_dias = $8, margen_seguridad_pct = $9 WHERE id_producto = $1`,
      [id, b.nombre, b.id_categoria, b.id_proveedor, b.unidad, b.precio_venta_clp, b.stock_minimo, b.vida_util_dias, b.margen_seguridad_pct]
    );
    if (!r.rowCount) throw new ApiError(404, 'no_encontrado', 'El producto no existe');
  } catch (e) {
    throw mapearErrorBD(e);
  }
  await evaluarSinFallar([id]);
  res.json({ data: await detalle(id) });
});

/** Baja lógica y reactivación. Al desactivar un producto se descartan sus alertas activas. */
router.patch('/:id/estado', catalogo, async (req, res) => {
  const id = idParam(req);
  const { activo } = parse(z.object({ activo: z.boolean({ error: 'Indica si el producto está activo' }) }), req.body);
  await withTransaction(async (client) => {
    const r = await client.query('UPDATE productos SET activo = $2 WHERE id_producto = $1', [id, activo]);
    if (!r.rowCount) throw new ApiError(404, 'no_encontrado', 'El producto no existe');
    if (!activo) {
      await client.query(`UPDATE alertas_inventario SET estado = 'descartada', resuelta_en = NOW() WHERE id_producto = $1 AND estado = 'activa'`, [id]);
    }
  });
  if (activo) await evaluarSinFallar([id]);
  res.json({ data: await detalle(id) });
});

/** RNF-10: un producto con ventas o compras no se elimina; se ofrece la baja lógica. */
router.delete('/:id', catalogo, async (req, res) => {
  const id = idParam(req);
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM ventas WHERE id_producto = $1) + (SELECT COUNT(*)::int FROM compras WHERE id_producto = $1) AS n`,
    [id]
  );
  if (rows[0].n > 0) {
    throw new ApiError(409, 'tiene_historial', 'El producto tiene ventas o compras registradas, por lo que no se puede eliminar. Puedes desactivarlo (baja lógica).');
  }
  await withTransaction(async (client) => {
    await client.query('DELETE FROM alertas_inventario WHERE id_producto = $1', [id]);
    await client.query('DELETE FROM predicciones WHERE id_producto = $1', [id]);
    const r = await client.query('DELETE FROM productos WHERE id_producto = $1', [id]);
    if (!r.rowCount) throw new ApiError(404, 'no_encontrado', 'El producto no existe');
  });
  res.status(204).end();
});

module.exports = router;
