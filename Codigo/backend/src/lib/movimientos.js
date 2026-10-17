/** Lógica común del registro de ventas (RF-01) y compras (RF-02): validación, transacción y saldo de stock. */
const { z } = require('zod');
const { ApiError } = require('./errors');
const { errorCampo, entero, redondear2 } = require('./http');

/** Fecha y hora opcional (ISO). No se aceptan instantes futuros (tolerancia de 5 minutos por desfase de reloj). */
const fechaHora = z
  .string({ error: 'Fecha y hora inválidas' })
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha y hora inválidas')
  .nullish();

function resolverFecha(valor) {
  if (!valor) return new Date();
  const d = new Date(valor);
  if (d.getTime() > Date.now() + 5 * 60 * 1000) throw errorCampo('fecha_hora', 'La fecha y hora no pueden estar en el futuro');
  return d;
}

/** Cantidad > 0 con hasta 2 decimales; entera si la unidad es «un». */
function validarCantidad(valor, unidad) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) throw errorCampo('cantidad', 'Ingresa una cantidad válida');
  const c = redondear2(valor);
  if (c <= 0) throw errorCampo('cantidad', 'La cantidad debe ser mayor que 0');
  if (c > 100000) throw errorCampo('cantidad', 'La cantidad es demasiado grande');
  if (unidad === 'un' && !Number.isInteger(c)) throw errorCampo('cantidad', 'Este producto se vende por unidad: ingresa un número entero');
  return c;
}

/** Bloquea la fila del producto (evita ventas simultáneas sobre el mismo saldo) y exige que esté activo. */
async function productoParaMovimiento(client, id) {
  const { rows } = await client.query(
    `SELECT id_producto, nombre, unidad, precio_venta_clp, stock_actual::float AS stock_actual, stock_minimo::float AS stock_minimo,
            id_proveedor, activo
       FROM productos WHERE id_producto = $1 FOR UPDATE`,
    [id]
  );
  const p = rows[0];
  if (!p) throw errorCampo('id_producto', 'El producto no existe');
  if (!p.activo) throw errorCampo('id_producto', 'El producto está inactivo');
  return p;
}

const baseSchema = { id_producto: entero('Elige un producto', 1), fecha_hora: fechaHora };

module.exports = { baseSchema, resolverFecha, validarCantidad, productoParaMovimiento, ApiError };
