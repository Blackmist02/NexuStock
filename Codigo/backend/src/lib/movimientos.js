/** Lógica común del registro de ventas (RF-01) y compras (RF-02): validación, transacción y saldo de stock. */
const { z } = require('zod');
const config = require('../config');
const fechaSistema = require('./fechaSistema');
const { ApiError } = require('./errors');
const { errorCampo, entero, redondear2 } = require('./http');

/** Fecha y hora opcional (ISO). No se aceptan instantes futuros (tolerancia de 5 minutos por desfase de reloj). */
const fechaHora = z
  .string({ error: 'Fecha y hora inválidas' })
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha y hora inválidas')
  .nullish();

/** Desfase de la zona del negocio en una fecha («-03:00»), para armar el instante local de esa fecha. */
function desfase(iso) {
  const parte = new Intl.DateTimeFormat('en-US', { timeZone: config.tz, timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${iso}T12:00:00Z`))
    .find((x) => x.type === 'timeZoneName').value; // «GMT-03:00» o «GMT»
  return parte === 'GMT' ? '+00:00' : parte.replace('GMT', '');
}

/**
 * Instante actual del negocio: ahora, o con fecha de referencia (datos históricos) ese día a la hora actual del local.
 * Así lo registrado a mano durante la demostración queda en la fecha del sistema y no en la fecha real.
 */
function ahoraNegocio() {
  const ref = fechaSistema.referencia();
  if (!ref) return new Date();
  const hora = new Intl.DateTimeFormat('en-GB', { timeZone: config.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .format(new Date())
    .replace(/^24/, '00');
  return new Date(`${ref}T${hora}${desfase(ref)}`);
}

function resolverFecha(valor) {
  if (!valor) return ahoraNegocio();
  const d = new Date(valor);
  if (d.getTime() > ahoraNegocio().getTime() + 5 * 60 * 1000) throw errorCampo('fecha_hora', 'La fecha y hora no pueden estar en el futuro');
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

module.exports = { baseSchema, ahoraNegocio, resolverFecha, validarCantidad, productoParaMovimiento, ApiError };
