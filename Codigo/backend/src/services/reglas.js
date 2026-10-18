// Reglas de negocio del semáforo y las sugerencias de compra (Historia 006). Funciones puras.
const { addDays, diffDays, isoWeekday } = require('../lib/dates');

const ORDEN = { optimo: 0, bajo: 1, quiebre: 2 };
const peorNivel = (a, b) => (ORDEN[a] >= ORDEN[b] ? a : b);

/**
 * Semáforo por demanda:
 *  - quiebre: stock < demanda proyectada
 *  - bajo:    stock < demanda proyectada + margen de seguridad
 *  - optimo:  en otro caso
 * `maximo` (stock máximo sin merma) acota ambos umbrales: no se exige tener más de lo que se vende antes de vencer.
 */
function nivelPorDemanda(stock, demanda, margenPct, maximo = Infinity) {
  if (stock < Math.min(demanda, maximo)) return 'quiebre';
  if (stock < Math.min(demanda * (1 + margenPct / 100), maximo)) return 'bajo';
  return 'optimo';
}

/**
 * Peso de cada día en la venta semanal, lunes a domingo (EDA 2022-2023), normalizado para sumar 1.
 * Reparte la demanda semanal proyectada entre los días del horizonte de reposición.
 */
const PESOS_DIA = (() => {
  const pct = [10.7, 11.8, 12.9, 14.4, 19.5, 23.0, 7.8];
  const total = pct.reduce((a, b) => a + b, 0);
  return pct.map((p) => p / total);
})();

const proximoHabil = (iso, habiles) => {
  let f = iso;
  for (let i = 0; i < 7 && !habiles.has(isoWeekday(f)); i++) f = addDays(f, 1);
  return f;
};

/**
 * Días que el stock de hoy debe cubrir: desde hoy hasta el día de llegada del pedido siguiente, inclusive.
 * h0 = primer día de atención del proveedor ≥ hoy (cuando puede emitirse el pedido); h1 = siguiente día de
 * atención > h0 (el pedido siguiente); ese pedido llega en h1 + lead time. Devuelve las fechas ISO del horizonte.
 */
function diasCobertura(hoyIso, leadTimeDias, diasHabiles) {
  const habiles = new Set(diasHabiles && diasHabiles.length ? diasHabiles.map(Number) : [1, 2, 3, 4, 5, 6, 7]);
  const h0 = proximoHabil(hoyIso, habiles);
  const h1 = proximoHabil(addDays(h0, 1), habiles);
  const llegada = addDays(h1, Number(leadTimeDias) || 0);
  const dias = [];
  for (let f = hoyIso; diffDays(f, llegada) <= 0; f = addDays(f, 1)) dias.push(f);
  return dias;
}

/**
 * Demanda del horizonte de reposición: la demanda semanal ponderada por el peso de cada día entre hoy y la
 * llegada del pedido siguiente (diasCobertura). Es la demanda contra la que se compara el stock en el semáforo.
 * Control de cambios ERS v02: reemplaza a la demanda de la semana completa, que dejaba en quiebre a casi todo el
 * catálogo. Complemento aprobado: reemplaza a "lead time + 1 día", que ignoraba los días de atención del
 * proveedor y dejaba entre 11 y 25 % de venta perdida en la evaluación 2024.
 */
function demandaReposicion(demandaSemana, leadTimeDias, diasHabiles, hoyIso) {
  const peso = diasCobertura(hoyIso, leadTimeDias, diasHabiles)
    .reduce((s, f) => s + PESOS_DIA[isoWeekday(f) - 1], 0);
  return demandaSemana * peso;
}

/** Stock máximo sin merma: lo que se vende durante la vida útil del producto (sin vida útil, sin tope). */
function stockMaximoPorVidaUtil(demandaSemana, vidaUtilDias) {
  return vidaUtilDias ? (demandaSemana / 7) * vidaUtilDias : Infinity;
}

/**
 * Demanda que el stock debe cubrir para el semáforo: la del horizonte de reposición, sin superar lo que se vende dentro
 * de la vida útil. Si el pedido siguiente llega después de que el producto vence, tener más stock solo produce merma:
 * el producto no se marca en quiebre por algo que no conviene comprar. Las compras resultantes no cambian, porque la
 * cantidad sugerida ya estaba acotada por vida útil.
 */
function demandaACubrir(demandaSemana, leadTimeDias, diasHabiles, hoyIso, vidaUtilDias, unidad = 'kg') {
  const rep = demandaReposicion(demandaSemana, leadTimeDias, diasHabiles, hoyIso);
  const topeExacto = stockMaximoPorVidaUtil(demandaSemana, vidaUtilDias);
  // Mismo redondeo hacia abajo que acotarPorVidaUtil (0,1 kg o unidades enteras)
  const tope = !Number.isFinite(topeExacto) ? Infinity : unidad === 'un' ? Math.floor(topeExacto + 1e-9) : Math.floor(topeExacto * 10 + 1e-9) / 10;
  return { demanda: Math.min(rep, tope), tope, acotada: tope < rep };
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
  PESOS_DIA,
  diasCobertura,
  demandaReposicion,
  demandaACubrir,
  stockMaximoPorVidaUtil,
  acotarPorVidaUtil,
  nivelPorMinimo,
  cantidadSugerida,
  fechaQuiebreEstimada,
  fechaLimitePedido
};
