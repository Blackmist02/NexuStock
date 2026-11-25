// Pruebas de las reglas de negocio (puras: no tocan la base de datos). Ejecutar con: npm test
const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  nivelPorDemanda,
  PESOS_DIA,
  diasCobertura,
  demandaReposicion,
  demandaACubrir,
  stockMaximoPorVidaUtil,
  nivelPorMinimo,
  cantidadSugerida,
  fechaLimitePedido,
  fechaQuiebreEstimada,
  peorNivel
} = require('../src/services/reglas');
const { isoWeekday, addDays } = require('../src/lib/dates');
const { passwordSchema, fingerprint } = require('../src/lib/password');

test('ejemplo del documento de diseño: stock 40, demanda 140, margen 10% → quiebre y 114 kg', () => {
  assert.equal(nivelPorDemanda(40, 140, 10), 'quiebre');
  assert.equal(cantidadSugerida(40, 140, 10, 'kg'), 114);
});

test('semáforo por demanda', () => {
  assert.equal(nivelPorDemanda(100, 140, 10), 'quiebre'); // stock < demanda
  assert.equal(nivelPorDemanda(145, 140, 10), 'bajo'); // demanda ≤ stock < demanda + margen
  assert.equal(nivelPorDemanda(154, 140, 10), 'optimo'); // stock ≥ demanda + margen
  assert.equal(nivelPorDemanda(0, 0, 10), 'optimo'); // sin demanda no hay riesgo por demanda
});

const LUN = '2026-10-05'; // lunes
const LUN_SAB = [1, 2, 3, 4, 5, 6];
const LUN_MIE_VIE = [1, 3, 5];
const redondear = (x) => Math.round(x * 100) / 100;

test('pesos de los días de la semana: lunes a domingo, suman 1', () => {
  assert.equal(PESOS_DIA.length, 7);
  assert.equal(redondear(PESOS_DIA.reduce((a, b) => a + b, 0)), 1);
  assert.ok(PESOS_DIA[5] > PESOS_DIA[0] && PESOS_DIA[6] < PESOS_DIA[0]); // el sábado vende más; el domingo, menos
});

test('días de cobertura: desde hoy hasta la llegada del pedido siguiente, inclusive', () => {
  // Proveedor lun-sáb, lead time 1, hoy lunes: pedido de hoy llega mar; el siguiente (mar) llega mié
  assert.deepEqual(diasCobertura(LUN, 1, LUN_SAB), ['2026-10-05', '2026-10-06', '2026-10-07']);
  // Proveedor lun-mié-vie, lead time 1, hoy lunes: el pedido siguiente es el miércoles y llega el jueves
  assert.equal(diasCobertura(LUN, 1, LUN_MIE_VIE).at(-1), '2026-10-08');
  // Viernes: el pedido siguiente es el lunes y llega el martes (cubre fin de semana)
  assert.deepEqual(diasCobertura('2026-10-09', 1, LUN_MIE_VIE), ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']);
  // Sábado, día sin atención: h0 = lunes, h1 = miércoles, llegada jueves
  assert.equal(diasCobertura('2026-10-10', 1, LUN_MIE_VIE).length, 6);
  // Importado: lead time 21, atiende de lunes a viernes; hoy lunes → pedido siguiente martes, llega 21 días después
  assert.equal(diasCobertura(LUN, 21, [1, 2, 3, 4, 5]).length, 23);
  // Sin días hábiles registrados se asume atención diaria
  assert.equal(diasCobertura(LUN, 1, []).length, 3);
});

test('demanda del horizonte de reposición con el calendario del proveedor (control de cambios ERS v02)', () => {
  // 70 kg/semana, lun-sáb, lead time 1, hoy lunes: lun + mar + mié = 35,4 % de la semana → 24,76 kg
  assert.equal(redondear(demandaReposicion(70, 1, LUN_SAB, LUN)), 24.76);
  // Mismo producto con proveedor lun-mié-vie: lun..jue = 49,8 % → 34,83 kg
  assert.equal(redondear(demandaReposicion(70, 1, LUN_MIE_VIE, LUN)), 34.83);
  // El viernes se cubre el fin de semana más fuerte: vie..mar = 72,8 % → 50,91 kg
  assert.equal(redondear(demandaReposicion(70, 1, LUN_MIE_VIE, '2026-10-09')), 50.91);
  const rep = demandaReposicion(70, 1, LUN_SAB, LUN);
  assert.equal(nivelPorDemanda(20, rep, 20), 'quiebre'); // 20 < 24,76
  assert.equal(nivelPorDemanda(26, rep, 20), 'bajo'); // 24,76 ≤ 26 < 29,71
  assert.equal(nivelPorDemanda(30, rep, 20), 'optimo');
  assert.equal(nivelPorDemanda(30, 70, 20), 'quiebre'); // con la semana completa sería quiebre
  assert.equal(demandaReposicion(0, 1, LUN_SAB, LUN), 0);
});

test('cantidad sugerida con demanda de reposición y tope por vida útil (control de cambios ERS v02)', () => {
  // Importado: 45 kg/semana, lead time 21, lun-vie → 3 semanas + lun y mar = 145,11 kg; vida útil 35 días → tope 225 kg
  const rep = demandaReposicion(45, 21, [1, 2, 3, 4, 5], LUN);
  assert.equal(redondear(rep), 145.11);
  assert.equal(cantidadSugerida(48, rep, 10, 'kg', 0, stockMaximoPorVidaUtil(45, 35)), 111.7);
  // Perecible: 70 kg/semana → reposición 24,76 kg; margen 20 % → 29,71; vida útil 3 días → tope 30 kg
  assert.equal(cantidadSugerida(5, demandaReposicion(70, 1, LUN_SAB, LUN), 20, 'kg', 0, stockMaximoPorVidaUtil(70, 3)), 24.8);
  // El tope manda cuando el stock mínimo pediría más de lo que se alcanza a vender: mínimo 40, tope 30
  assert.equal(cantidadSugerida(5, 20, 10, 'kg', 40, stockMaximoPorVidaUtil(70, 3)), 25);
  assert.equal(stockMaximoPorVidaUtil(70, null), Infinity);
});

test('demanda a cubrir en el semáforo: el horizonte de reposición, sin superar la vida útil', () => {
  // 70 kg/semana, proveedor lun-mié-vie, viernes: el pedido siguiente llega el martes (50,91 kg en 5 días)
  const vie = '2026-10-09';
  assert.deepEqual(demandaACubrir(70, 1, LUN_MIE_VIE, vie, null), { demanda: demandaReposicion(70, 1, LUN_MIE_VIE, vie), tope: Infinity, acotada: false });
  // Con 3 días de vida útil solo se alcanzan a vender 30 kg: cubrir más es merma, no un quiebre evitable
  const r = demandaACubrir(70, 1, LUN_MIE_VIE, vie, 3);
  assert.equal(r.demanda, 30);
  assert.equal(r.acotada, true);
  // Con el stock máximo útil el producto queda óptimo (antes: quiebre, 30 < 50,91, sin nada que comprar)
  assert.equal(nivelPorDemanda(30, r.demanda, 20, r.tope), 'optimo');
  assert.equal(nivelPorDemanda(29, r.demanda, 20, r.tope), 'quiebre');
  assert.equal(cantidadSugerida(30, r.demanda, 20, 'kg', 0, stockMaximoPorVidaUtil(70, 3)), 0);
  // El tope se redondea como la cantidad sugerida: 24,64 kg/semana × 4 días = 14,08 → 14,0 kg
  const alitas = demandaACubrir(24.64, 2, LUN_MIE_VIE, '2026-10-05', 4);
  assert.equal(alitas.tope, 14);
  assert.equal(nivelPorDemanda(14.05, alitas.demanda, 20, alitas.tope), 'optimo');
  // Sin acotar por vida útil, el margen sigue mandando
  assert.equal(nivelPorDemanda(26, 24.76, 20, Infinity), 'bajo');
});

test('umbral local de stock mínimo', () => {
  assert.equal(nivelPorMinimo(0, 5), 'quiebre');
  assert.equal(nivelPorMinimo(4, 5), 'bajo');
  assert.equal(nivelPorMinimo(5, 5), 'optimo');
  assert.equal(peorNivel('bajo', 'quiebre'), 'quiebre');
});

test('cantidad sugerida: kg a 0,1 hacia arriba; unidades enteras; nunca negativa', () => {
  assert.equal(cantidadSugerida(1.2, 13.05, 0, 'kg'), 11.9);
  assert.equal(cantidadSugerida(3, 7.2, 0, 'un'), 5);
  assert.equal(cantidadSugerida(500, 10, 10, 'kg'), 0);
});

test('fecha de quiebre estimada', () => {
  assert.equal(fechaQuiebreEstimada('2026-10-05', 0, 70), '2026-10-05');
  assert.equal(fechaQuiebreEstimada('2026-10-05', 30, 70), '2026-10-08'); // 10 kg/día → 3 días
  assert.equal(fechaQuiebreEstimada('2026-10-05', 30, 0), '2027-10-05');
});

test('fecha límite de pedido se adelanta al día hábil anterior del proveedor', () => {
  const lunVie = [1, 2, 3, 4, 5];
  assert.equal(isoWeekday('2026-10-12'), 1);
  assert.equal(fechaLimitePedido('2026-10-12', 1, lunVie, '2026-10-05'), '2026-10-09'); // domingo → viernes
  assert.equal(fechaLimitePedido('2026-10-12', 1, [1, 2, 3, 4, 5, 6], '2026-10-05'), '2026-10-10'); // sábado sí es hábil
  assert.equal(fechaLimitePedido('2026-10-06', 3, lunVie, '2026-10-05'), '2026-10-05'); // nunca anterior a hoy
});

test('fechas auxiliares', () => {
  assert.equal(addDays('2026-02-27', 3), '2026-03-02');
  assert.equal(isoWeekday('2026-10-11'), 7);
});

test('política de contraseña: 8+ caracteres, una mayúscula y un número', () => {
  assert.equal(passwordSchema.safeParse('Clave1234').success, true);
  assert.equal(passwordSchema.safeParse('clave1234').success, false);
  assert.equal(passwordSchema.safeParse('Clavecorta').success, false);
  assert.equal(passwordSchema.safeParse('C1').success, false);
});

test('la huella de contraseña cambia con el hash (invalida sesiones y enlaces)', () => {
  assert.notEqual(fingerprint('hash-a'), fingerprint('hash-b'));
  assert.equal(fingerprint('hash-a'), fingerprint('hash-a'));
});
