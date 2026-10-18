/**
 * Fecha de referencia vigente del sistema («hoy» cuando se muestran datos históricos). Parte de FECHA_REFERENCIA y la
 * reemplaza el valor guardado en CONFIGURACION (lib/negocio.js), que el administrador cambia desde Configuración sin
 * reiniciar el servidor. Cadena vacía = se usa la fecha real.
 */
const config = require('../config');

let valor = config.fechaReferencia || '';
let origen = valor ? 'entorno' : 'real';

/** AAAA-MM-DD de referencia, o '' si el sistema usa la fecha real. */
const referencia = () => valor;

/** 'base' (guardada en CONFIGURACION), 'entorno' (FECHA_REFERENCIA) o 'real'. */
const origenReferencia = () => origen;

/** Fija la referencia: una fecha, o null/'' para usar la fecha real. `desde` indica de dónde viene. */
function fijar(fecha, desde = 'base') {
  valor = fecha || '';
  origen = valor ? desde : 'real';
}

module.exports = { referencia, origenReferencia, fijar };
