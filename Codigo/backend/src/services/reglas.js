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

/**
 * Demanda del horizonte de reposición: lo que se venderá hasta que pueda llegar un pedido emitido hoy
 * (lead time del proveedor + 1 día). Es la demanda contra la que se compara el stock en el semáforo.
 * Control de cambios ERS v02: reemplaza a la demanda de la semana completa, que dejaba en quiebre a casi
 * todo el catálogo porque una carnicería mantiene de 1 a 5 días de stock (vida útil corta, entrega diaria).
 */
function demandaReposicion(demandaSemana, leadTimeDias) {
  return (demandaSemana / 7) * (leadTimeDias + 1);
}

/** Stock máximo sin merma: lo que se vende durante la vida útil del producto (sin vida útil, sin tope). */
function stockMaximoPorVidaUtil(demandaSemana, vidaUtilDias) {
  return vidaUtilDias ? (demandaSemana / 7) * vidaUtilDias : Infinity;
}

/** Umbral local (stock_minimo): sin stock = quiebre; bajo el mínimo = bajo. */
function nivelPorMinimo(stock, stockMinimo) {
  if (stock <= 0) return 'quiebre';
  if (stockMinimo > 0 && stock < stockMinimo) return 'bajo';
  return 'optimo';
}

/**
 * Cantidad a pedir = demanda·(1+margen) − stock, redondeada hacia arriba (kg a 0,1; un enteras).
 * `demanda` es la del horizonte de reposición. `stockMaximo` acota el stock resultante a lo que se alcanza a
 * vender antes de que venza el producto (tope por vida útil del ERS; ver stockMaximoPorVidaUtil).
 */
function cantidadSugerida(stock, demanda, margenPct, unidad, stockMinimo = 0, stockMaximo = Infinity) {
  const objetivo = Math.min(
    Math.max(demanda * (1 + margenPct / 100), stockMinimo * (1 + margenPct / 100)),
    stockMaximo
  );
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

/**
 * Excepción 3a de RF-09: la sugerencia no puede superar lo que se alcanza a vender dentro de la vida útil
 * de refrigeración (demanda diaria × vida útil en días). Con `stock`, el tope se aplica al stock resultante
 * (stock + pedido), de modo que nada quede sin vender al vencer. Sin demanda o sin vida útil no se acota.
 */
function acotarPorVidaUtil(cantidad, demandaSemana, vidaUtilDias, unidad, stock = 0) {
  if (!vidaUtilDias || !(demandaSemana > 0) || cantidad <= 0) return { cantidad, acotada: false };
  const tope = Math.max(0, stockMaximoPorVidaUtil(demandaSemana, vidaUtilDias) - stock);
  if (cantidad <= tope) return { cantidad, acotada: false };
  const c = unidad === 'un' ? Math.floor(tope + 1e-9) : Math.floor(tope * 10 + 1e-9) / 10;
  return { cantidad: c, acotada: true };
}

module.exports = {
  ORDEN,
  peorNivel,
  nivelPorDemanda,
  demandaReposicion,
  stockMaximoPorVidaUtil,
  acotarPorVidaUtil,
  nivelPorMinimo,
  cantidadSugerida,
  fechaQuiebreEstimada,
  fechaLimitePedido
};
