/**
 * Precisión del motor (RF-06): MAE en kg del respaldo «promedio histórico» medido con retroceso (backtest) sobre
 * ventas semanales reales. Sirve de línea base para comparar el modelo y como indicador del respaldo.
 */
const config = require('../config');
const db = require('../db');
const { addDays, inicioSemana } = require('../lib/dates');
const { eventosEnRango } = require('./eventos');

const TIPOS_FESTIVOS = new Set(['fiestas_patrias', 'semana_santa', 'feriado_largo']);

/**
 * MAE del promedio de las `n` semanas previas contra las ventas reales de cada semana entre `desde` y `hasta`
 * (productos en kg). Devuelve { mae_general, mae_festivos, productos: Map, observaciones } o null si no hay datos.
 */
async function maeRespaldo(desde, hasta, n = config.demandaSemanasHistorial) {
  const ini = inicioSemana(desde);
  const fin = inicioSemana(hasta);
  const { rows } = await db.query(
    `SELECT v.id_producto, to_char(date_trunc('week', v.fecha_hora AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS semana, SUM(v.cantidad)::float AS kg
       FROM ventas v JOIN productos p ON p.id_producto = v.id_producto
      WHERE p.unidad = 'kg' AND (v.fecha_hora AT TIME ZONE $1)::date >= $2::date AND (v.fecha_hora AT TIME ZONE $1)::date < $3::date + 7
      GROUP BY 1, 2`,
    [config.tz, addDays(ini, -7 * n), fin]
  );
  if (!rows.length) return null;
  const porProducto = new Map();
  for (const r of rows) {
    if (!porProducto.has(r.id_producto)) porProducto.set(r.id_producto, new Map());
    porProducto.get(r.id_producto).set(r.semana, r.kg);
  }
  const eventos = await eventosEnRango(ini, addDays(fin, 6));
  const semanaFestiva = new Set(eventos.filter((e) => TIPOS_FESTIVOS.has(e.tipo)).map((e) => inicioSemana(e.fecha)));

  let sumaG = 0, nG = 0, sumaF = 0, nF = 0;
  const productos = new Map();
  for (const [id, semanas] of porProducto) {
    const primera = [...semanas.keys()].sort()[0];
    let sumaP = 0, nP = 0;
    for (let s = ini; s <= fin; s = addDays(s, 7)) {
      if (s <= primera) continue; // sin historial previo no hay respaldo por producto
      let total = 0;
      for (let k = 1; k <= n; k++) {
        const w = addDays(s, -7 * k);
        if (w >= primera) total += semanas.get(w) || 0;
      }
      const previas = Math.min(n, Math.round((new Date(`${s}T00:00:00Z`) - new Date(`${primera}T00:00:00Z`)) / (7 * 86400000)));
      const err = Math.abs((semanas.get(s) || 0) - total / Math.max(1, previas));
      sumaG += err; nG++; sumaP += err; nP++;
      if (semanaFestiva.has(s)) { sumaF += err; nF++; }
    }
    if (nP) productos.set(id, sumaP / nP);
  }
  if (!nG) return null;
  const r2 = (x) => Math.round(x * 1000) / 1000;
  return { mae_general: r2(sumaG / nG), mae_festivos: nF ? r2(sumaF / nF) : null, productos, observaciones: nG };
}

module.exports = { maeRespaldo };
