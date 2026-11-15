// Casos borde del semáforo, la cantidad sugerida y el respaldo de demanda (tarea 27). Sin base de datos: npm test
const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  nivelPorDemanda,
  nivelPorMinimo,
  peorNivel,
  diasCobertura,
  demandaReposicion,
  cantidadSugerida,
  fechaQuiebreEstimada,
  fechaLimitePedido,
  acotarPorVidaUtil
} = require('../src/services/reglas');

const LUN = '2026-10-05'; // lunes
const LUN_SAB = [1, 2, 3, 4, 5, 6];

test('stock en cero: quiebre en ambos umbrales, agotado hoy y se pide la demanda más el margen', () => {
  assert.equal(nivelPorDemanda(0, 10, 10), 'quiebre');
  assert.equal(nivelPorMinimo(0, 0), 'quiebre'); // sin stock es quiebre aunque no haya mínimo definido
  assert.equal(nivelPorMinimo(-2, 5), 'quiebre'); // un saldo negativo (ajuste pendiente) también
  assert.equal(peorNivel(nivelPorDemanda(0, 0, 10), nivelPorMinimo(0, 0)), 'quiebre');
  assert.equal(fechaQuiebreEstimada(LUN, 0, 70), LUN);
  assert.equal(cantidadSugerida(0, 10, 10, 'kg'), 11);
  assert.equal(cantidadSugerida(0, 10, 10, 'un'), 11);
});

test('pico estacional (Fiestas Patrias): el mismo stock pasa de óptimo a quiebre y la sugerencia crece', () => {
  const normal = demandaReposicion(70, 1, LUN_SAB, LUN); // 24,76 kg
  const fiestas = demandaReposicion(70 * 3, 1, LUN_SAB, LUN); // semana con el triple de venta
  assert.equal(nivelPorDemanda(30, normal, 20), 'optimo');
  assert.equal(nivelPorDemanda(30, fiestas, 20), 'quiebre');
  assert.equal(cantidadSugerida(30, normal, 20, 'kg'), 0);
  assert.equal(cantidadSugerida(30, fiestas, 20, 'kg'), 59.2); // 74,27 × 1,2 − 30 = 59,12 → 59,2 (kg a 0,1 hacia arriba)
  // El agotamiento se adelanta: 30 kg duran 3 días a 10 kg/día y 1 día a 30 kg/día
  assert.equal(fechaQuiebreEstimada(LUN, 30, 70), '2026-10-08');
  assert.equal(fechaQuiebreEstimada(LUN, 30, 210), '2026-10-06');
});

test('proveedor con lead time extendido: el horizonte cubre todo el plazo y el pedido es para hoy', () => {
  // Importado: lead time de 30 días, atiende de lunes a viernes. Hoy lunes: pedido siguiente el martes, llega 30 días después
  const dias = diasCobertura(LUN, 30, [1, 2, 3, 4, 5]);
  assert.equal(dias[0], LUN);
  assert.equal(dias.at(-1), '2026-11-05');
  assert.equal(dias.length, 32);
  // Demanda del horizonte ≈ 4,6 semanas: con 100 kg en stock hay quiebre aunque cubran una semana completa
  assert.ok(demandaReposicion(70, 30, [1, 2, 3, 4, 5], LUN) > 300);
  assert.equal(nivelPorDemanda(100, demandaReposicion(70, 30, [1, 2, 3, 4, 5], LUN), 10), 'quiebre');
  // Si el quiebre llega antes que el plazo de entrega, la fecha límite es hoy (nunca una fecha pasada)
  assert.equal(fechaLimitePedido('2026-10-12', 30, [1, 2, 3, 4, 5], LUN), LUN);
});

test('proveedor sin días hábiles registrados: se asume atención diaria en todas las reglas', () => {
  for (const sinDias of [[], null, undefined]) {
    assert.deepEqual(diasCobertura(LUN, 1, sinDias), ['2026-10-05', '2026-10-06', '2026-10-07']);
    assert.equal(demandaReposicion(70, 1, sinDias, LUN), demandaReposicion(70, 1, [1, 2, 3, 4, 5, 6, 7], LUN));
    // Quiebre el lunes 12 con lead time 1 → el domingo 11 sí cuenta como día de pedido
    assert.equal(fechaLimitePedido('2026-10-12', 1, sinDias, LUN), '2026-10-11');
  }
  // Un proveedor que solo atiende un día a la semana: el horizonte cubre hasta la llegada del pedido de la semana siguiente
  assert.equal(diasCobertura(LUN, 1, [1]).at(-1), '2026-10-13');
});

test('tope por vida útil: sin demanda o sin vida útil no se acota; con stock se descuenta del tope', () => {
  assert.deepEqual(acotarPorVidaUtil(50, 0, 3, 'kg'), { cantidad: 50, acotada: false });
  assert.deepEqual(acotarPorVidaUtil(50, 70, null, 'kg'), { cantidad: 50, acotada: false });
  assert.deepEqual(acotarPorVidaUtil(50, 70, 3, 'kg'), { cantidad: 30, acotada: true }); // 10 kg/día × 3 días
  assert.deepEqual(acotarPorVidaUtil(50, 70, 3, 'kg', 25), { cantidad: 5, acotada: true });
  assert.deepEqual(acotarPorVidaUtil(10, 70, 3, 'un', 25.5), { cantidad: 4, acotada: true }); // unidades enteras hacia abajo
  assert.deepEqual(acotarPorVidaUtil(50, 70, 3, 'kg', 40), { cantidad: 0, acotada: true });
});

test('respaldo de demanda (RF-11): promedio histórico y, sin historial, promedio de la categoría', async () => {
  const db = require('../src/db');
  const { demandaSemanasHistorial: semanas } = require('../src/config');
  const original = db.query;
  // Fotografía que devolvería la consulta: 3 productos de la categoría 1 y uno de la categoría 2
  db.query = async () => ({
    rows: [
      { id_producto: 1, id_categoria: 1, primera_venta: '2024-01-01', total: 10 * semanas * 7, dias_historial: 400 }, // ventana completa: 10/día
      { id_producto: 2, id_categoria: 1, primera_venta: '2024-09-25', total: 21, dias_historial: 3 }, // historial corto: mín. 7 días
      { id_producto: 3, id_categoria: 1, primera_venta: null, total: 0, dias_historial: null }, // nuevo: usa su categoría
      { id_producto: 4, id_categoria: 2, primera_venta: null, total: 0, dias_historial: null } // categoría sin historial
    ]
  });
  try {
    const { promedioHistorico } = require('../src/services/demanda');
    const r = await promedioHistorico.estimar([1, 2, 3, 4, 99], 'semana');
    assert.deepEqual(r.get(1), { demanda: 70, origen: 'promedio_historico' });
    assert.deepEqual(r.get(2), { demanda: 21, origen: 'promedio_historico' }); // 21 kg ÷ 7 días × 7
    assert.deepEqual(r.get(3), { demanda: 45.5, origen: 'categoria' }); // (10 + 3) ÷ 2 × 7
    assert.deepEqual(r.get(4), { demanda: 0, origen: 'categoria' });
    assert.equal(r.has(99), false); // inactivo o inexistente: sin estimación
    const mes = await promedioHistorico.estimar([1], 'mes');
    assert.equal(mes.get(1).demanda, 300);
  } finally {
    db.query = original;
  }
});
