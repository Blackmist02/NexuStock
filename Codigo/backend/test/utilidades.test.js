// Pruebas puras (sin base de datos): tope por vida útil, calendario de feriados, CSV y fechas.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { acotarPorVidaUtil } = require('../src/services/reglas');
const { feriadosChile, pascua } = require('../src/services/eventos');
const { toCsv } = require('../src/lib/csv');
const { addDays, inicioSemana, inicioMes, finMes, esFechaIso } = require('../src/lib/dates');

test('vida útil: no se sugiere comprar más de lo que se alcanza a vender', () => {
  // demanda 70 kg/semana = 10 kg/día; vida útil 3 días → tope 30 kg
  assert.deepEqual(acotarPorVidaUtil(100, 70, 3, 'kg'), { cantidad: 30, acotada: true });
  assert.deepEqual(acotarPorVidaUtil(20, 70, 3, 'kg'), { cantidad: 20, acotada: false });
  // sin vida útil o sin demanda no se acota
  assert.deepEqual(acotarPorVidaUtil(100, 70, null, 'kg'), { cantidad: 100, acotada: false });
  assert.deepEqual(acotarPorVidaUtil(100, 0, 3, 'kg'), { cantidad: 100, acotada: false });
  // unidades: se redondea hacia abajo a un entero
  assert.deepEqual(acotarPorVidaUtil(50, 17, 3, 'un'), { cantidad: 7, acotada: true });
});

test('Domingo de Pascua (algoritmo) y feriados móviles de Chile', () => {
  assert.equal(pascua(2024), '2024-03-31');
  assert.equal(pascua(2025), '2025-04-20');
  assert.equal(pascua(2026), '2026-04-05');
  const f26 = new Map(feriadosChile(2026).map((e) => [e.nombre, e]));
  assert.equal(f26.get('Viernes Santo').fecha, '2026-04-03');
  assert.equal(f26.get('Viernes Santo').tipo, 'semana_santa');
  assert.equal(f26.get('Fiestas Patrias').fecha, '2026-09-18');
  assert.equal(f26.get('Fiestas Patrias').tipo, 'fiestas_patrias');
  assert.equal(f26.get('Año Nuevo').fecha, '2026-01-01');
  // 12 de octubre de 2026 es lunes: no se traslada
  assert.equal(f26.get('Encuentro de Dos Mundos').fecha, '2026-10-12');
});

test('CSV para Excel en español: BOM, separador «;», coma decimal y comillas', () => {
  const csv = toCsv(
    [
      { titulo: 'Producto', valor: (r) => r.n },
      { titulo: 'Cantidad', valor: (r) => r.c }
    ],
    [{ n: 'Lomo; vetado', c: 1.5 }, { n: 'Chorizo "parrillero"', c: 4 }, { n: null, c: 0 }]
  );
  assert.ok(csv.startsWith('﻿Producto;Cantidad\r\n'));
  assert.ok(csv.includes('"Lomo; vetado";1,5\r\n'));
  assert.ok(csv.includes('"Chorizo ""parrillero""";4\r\n'));
  assert.ok(csv.includes(';0\r\n'));
});

test('fechas: lunes de la semana, inicio y fin de mes, validación ISO', () => {
  assert.equal(inicioSemana('2026-10-16'), '2026-10-12'); // viernes → lunes
  assert.equal(inicioSemana('2026-10-12'), '2026-10-12');
  assert.equal(inicioMes('2026-10-16'), '2026-10-01');
  assert.equal(finMes('2026-02-10'), '2026-02-28');
  assert.equal(finMes('2024-02-10'), '2024-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(esFechaIso('2026-02-30'), false);
  assert.equal(esFechaIso('2026-10-16'), true);
  assert.equal(esFechaIso('16/10/2026'), false);
});
