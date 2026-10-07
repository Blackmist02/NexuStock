// Reglas de negocio del semáforo y las sugerencias de compra (Historia 006). Funciones puras.
const { addDays, diffDays, isoWeekday } = require('../lib/dates');

const ORDEN = { optimo: 0, bajo: 1, quiebre: 2 };
const peorNivel = (a, b) => (ORDEN[a] >= ORDEN[b] ? a : b);

/**
 * Semáforo por demanda:
 *  - quiebre: stock < demanda proyectada
 *  - bajo:    stock < demanda proyectada + margen de seguridad
 *  - optimo:  en otro caso
 */
function nivelPorDemanda(stock, demanda, margenPct) {
  if (stock < demanda) return 'quiebre';
  if (stock < demanda * (1 + margenPct / 100)) return 'bajo';
  return 'optimo';
}

/** Umbral local (stock_minimo): sin stock = quiebre; bajo el mínimo = bajo. */
function nivelPorMinimo(stock, stockMinimo) {
  if (stock <= 0) return 'quiebre';
  if (stockMinimo > 0 && stock < stockMinimo) return 'bajo';
  return 'optimo';
}

/** Cantidad a pedir = demanda·(1+margen) − stock, redondeada hacia arriba (kg a 0,1; un enteras). */
function cantidadSugerida(stock, demanda, margenPct, unidad, stockMinimo = 0) {
  const objetivo = Math.max(demanda * (1 + margenPct / 100), stockMinimo * (1 + margenPct / 100));
  const falta = Math.max(0, objetivo - stock);
  return (unidad === 'un' ? Math.ceil(falta - 1e-9) : Math.ceil(falta * 10 - 1e-9) / 10) || 0;
}

/** Fecha estimada de agotamiento según la demanda semanal proyectada. */
function fechaQuiebreEstimada(hoy, stock, demandaSemana) {
  if (stock <= 0) return hoy;
  const diaria = demandaSemana / 7;
  if (diaria <= 0) return addDays(hoy, 365);
  return addDays(hoy, Math.min(365, Math.floor(stock / diaria)));
}

/**
 * Fecha límite para emitir el pedido: fecha de quiebre − lead time (días de corrido), ajustada al día
 * hábil anterior del proveedor (dias_habiles, ISO 1 = lunes … 7 = domingo). Nunca anterior a hoy.
 */
function fechaLimitePedido(fechaQuiebre, leadTimeDias, diasHabiles, hoy) {
  let f = addDays(fechaQuiebre, -leadTimeDias);
  if (diffDays(f, hoy) <= 0) return hoy;
  const habiles = new Set(diasHabiles && diasHabiles.length ? diasHabiles : [1, 2, 3, 4, 5, 6, 7]);
  for (let i = 0; i < 7 && !habiles.has(isoWeekday(f)); i++) f = addDays(f, -1);
  return diffDays(f, hoy) < 0 ? hoy : f;
}

module.exports = { ORDEN, peorNivel, nivelPorDemanda, nivelPorMinimo, cantidadSugerida, fechaQuiebreEstimada, fechaLimitePedido };
