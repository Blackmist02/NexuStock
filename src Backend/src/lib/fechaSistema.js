/**
 * Fecha de referencia vigente del sistema («hoy» cuando se muestran datos históricos). Parte de FECHA_REFERENCIA y la
 * reemplaza el valor guardado en CONFIGURACION (lib/negocio.js), que el administrador cambia desde Configuración sin
 * reiniciar el servidor. Cadena vacía = se usa la fecha real.
 */
const config = require('../config');

let valor = config.fechaReferencia || '';
let origen = valor ? 'entorno' : 'real';
// Última fecha de referencia usada: se conserva al pasar a la fecha real para poder volver a ella
let ultima = valor;

/** AAAA-MM-DD de referencia, o '' si el sistema usa la fecha real. */
const referencia = () => valor;

/** 'base' (guardada en CONFIGURACION), 'entorno' (FECHA_REFERENCIA) o 'real'. */
const origenReferencia = () => origen;

/** Última fecha de referencia (la vigente o la que había antes de pasar a la fecha real), o ''. */
const ultimaReferencia = () => ultima;

/**
 * Fija la referencia: una fecha, o null/'' para usar la fecha real. `desde` indica de dónde viene; `anterior` es la
 * última referencia guardada (al leer la base cuando el sistema está en la fecha real).
 */
function fijar(fecha, desde = 'base', anterior) {
  valor = fecha || '';
  origen = valor ? desde : 'real';
  ultima = valor || anterior || ultima;
}

module.exports = { referencia, origenReferencia, ultimaReferencia, fijar };
