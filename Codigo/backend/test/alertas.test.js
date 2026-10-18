// Causa de cada alerta, deducida de su fotografía (función pura). Ejecutar con: npm test
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { causaAlerta, CAUSAS } = require('../src/services/alertas');
const { demandaReposicion, nivelPorDemanda, nivelPorMinimo, peorNivel } = require('../src/services/reglas');

const alerta = (stock, demanda, margen = 10) => ({ stock_actual: stock, demanda_proyectada: demanda, margen_seguridad_pct: margen });

test('causa de la alerta según su fotografía', () => {
  assert.equal(causaAlerta(alerta(0, 20)), 'sin_stock');
  assert.equal(causaAlerta(alerta(15, 20)), 'demanda_reposicion'); // 15 < 20
  assert.equal(causaAlerta(alerta(21, 20)), 'margen_seguridad'); // 20 ≤ 21 < 22
  assert.equal(causaAlerta(alerta(25, 20)), 'stock_minimo'); // cubre demanda y margen: solo queda el mínimo
  for (const c of ['sin_stock', 'demanda_reposicion', 'margen_seguridad', 'stock_minimo']) assert.ok(CAUSAS[c]);
});

test('la causa es coherente con el nivel del semáforo', () => {
  // 70 kg/semana, lead time 1 → reposición 20 kg; stock mínimo 30
  const rep = demandaReposicion(70, 1);
  const casos = [
    [15, 'quiebre', 'demanda_reposicion'],
    [21, 'bajo', 'margen_seguridad'],
    [25, 'bajo', 'stock_minimo']
  ];
  for (const [stock, nivel, causa] of casos) {
    assert.equal(peorNivel(nivelPorDemanda(stock, rep, 10), nivelPorMinimo(stock, 30)), nivel);
    assert.equal(causaAlerta(alerta(stock, rep)), causa);
  }
});
