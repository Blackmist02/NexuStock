// Pruebas de las reglas de negocio (puras: no tocan la base de datos). Ejecutar con: npm test
const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  nivelPorDemanda,
  demandaReposicion,
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

test('demanda del horizonte de reposición: lead time + 1 día (control de cambios ERS v02)', () => {
  assert.equal(demandaReposicion(70, 1), 20); // 10 kg/día × 2 días
  assert.equal(demandaReposicion(70, 21), 220); // importado por vía marítima
  assert.equal(nivelPorDemanda(15, demandaReposicion(70, 1), 10), 'quiebre'); // 15 < 20
  assert.equal(nivelPorDemanda(21, demandaReposicion(70, 1), 10), 'bajo'); // 20 ≤ 21 < 22
  assert.equal(nivelPorDemanda(25, demandaReposicion(70, 1), 10), 'optimo');
  assert.equal(nivelPorDemanda(25, 70, 10), 'quiebre'); // con la regla anterior (semana completa) sería quiebre
});

test('cantidad sugerida con demanda de reposición y tope por vida útil (control de cambios ERS v02)', () => {
  // Importado: 45 kg/semana, lead time 21 → reposición 141,43 kg; vida útil 35 días → tope 225 kg
  const rep = demandaReposicion(45, 21);
  assert.equal(cantidadSugerida(48, rep, 10, 'kg', 0, stockMaximoPorVidaUtil(45, 35)), 107.6);
  // Perecible: 70 kg/semana, lead time 1 → reposición 20 kg; vida útil 3 días → tope 30 kg
  assert.equal(cantidadSugerida(5, demandaReposicion(70, 1), 10, 'kg', 0, stockMaximoPorVidaUtil(70, 3)), 17);
  // El tope manda cuando el stock mínimo pediría más de lo que se alcanza a vender: mínimo 40, tope 30
  assert.equal(cantidadSugerida(5, 20, 10, 'kg', 40, stockMaximoPorVidaUtil(70, 3)), 25);
  assert.equal(stockMaximoPorVidaUtil(70, null), Infinity);
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
