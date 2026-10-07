// Pruebas de las reglas de negocio (puras: no tocan la base de datos). Ejecutar con: npm test
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { nivelPorDemanda, nivelPorMinimo, cantidadSugerida, fechaLimitePedido, fechaQuiebreEstimada, peorNivel } = require('../src/services/reglas');
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
