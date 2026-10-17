const { z } = require('zod');
const { ApiError } = require('./errors');
const { esFechaIso } = require('./dates');

/** Identificador numérico de la ruta (:id). */
function idParam(req, nombre = 'id') {
  const n = Number(req.params[nombre]);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, 'validacion', 'Identificador inválido');
  return n;
}

/** Error de validación asociado a un campo (el frontend lo muestra junto al campo). */
const errorCampo = (campo, mensaje, status = 400) =>
  new ApiError(status, 'validacion', 'Datos inválidos', [{ campo, mensaje }]);

/** Fecha AAAA-MM-DD opcional de la query. */
function fechaQuery(valor, campo) {
  if (valor === undefined || valor === '') return null;
  if (!esFechaIso(valor)) throw errorCampo(campo, 'Fecha inválida (usa AAAA-MM-DD)');
  return valor;
}

const entero = (msg, min = 0, max = 2_000_000_000) =>
  z.number({ error: msg }).int(msg).min(min, msg).max(max, msg);

/** Cantidad con hasta 2 decimales (NUMERIC(10,2)). */
const redondear2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function paginacion(query, porDefecto = 25, maximo = 100) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maximo, Math.max(1, parseInt(query.pageSize, 10) || porDefecto));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const UNICOS = {
  productos: ['id_producto', 'Ya existe un producto con ese nombre'],
  categorias: ['id_categoria', 'Ya existe una categoría con ese nombre'],
  proveedores: ['id_proveedor', 'Ya existe un proveedor con ese nombre']
};

/** El nombre no puede repetirse ni cambiando mayúsculas/minúsculas («Lomo» = «lomo»). La restricción de la BD distingue mayúsculas. */
async function validarNombreUnico(db, tabla, nombre, idExcluir = null) {
  const [col, mensaje] = UNICOS[tabla];
  const { rowCount } = await db.query(`SELECT 1 FROM ${tabla} WHERE lower(nombre) = lower($1) AND ($2::bigint IS NULL OR ${col} <> $2)`, [nombre, idExcluir]);
  if (rowCount) throw errorCampo('nombre', mensaje);
}

module.exports = { idParam, errorCampo, fechaQuery, entero, redondear2, paginacion, validarNombreUnico };
