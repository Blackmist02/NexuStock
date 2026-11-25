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

/**
 * Precisión en operación: compara la predicción semanal que el sistema registró con origen «modelo» (PREDICCIONES,
 * hecha solo con las ventas anteriores a cada semana) con la venta real de esa semana, para las semanas completas entre
 * `desde` y `hasta`. Si una semana tiene varias predicciones del mismo producto se usa la última.
 * Devuelve { mae_general, mae_festivos, observaciones, semanas, productos: Map<id, { mae, n }> } o null si no hay datos.
 */
async function maeOperacion(desde, hasta) {
  const ini = inicioSemana(desde);
  const fin = addDays(inicioSemana(hasta), 7); // exclusivo: incluye la semana de `hasta`
  const { rows } = await db.query(
    `WITH pred AS (
       SELECT DISTINCT ON (id_producto, fecha_objetivo) id_producto, fecha_objetivo, demanda_pred::float AS pred
         FROM predicciones
        WHERE horizonte = 'semana' AND origen = 'modelo' AND fecha_objetivo >= $2::date AND fecha_objetivo < $3::date
        ORDER BY id_producto, fecha_objetivo, generada_en DESC
     ), real AS (
       SELECT id_producto, date_trunc('week', fecha_hora AT TIME ZONE $1)::date AS semana, SUM(cantidad)::float AS kg
         FROM ventas
        WHERE fecha_hora >= ($2::date::timestamp AT TIME ZONE $1) AND fecha_hora < ($3::date::timestamp AT TIME ZONE $1)
        GROUP BY 1, 2
     )
     SELECT p.id_producto, to_char(p.fecha_objetivo, 'YYYY-MM-DD') AS semana, p.pred, COALESCE(r.kg, 0) AS kg
       FROM pred p JOIN productos pr ON pr.id_producto = p.id_producto AND pr.unidad = 'kg'
       LEFT JOIN real r ON r.id_producto = p.id_producto AND r.semana = p.fecha_objetivo`,
    [config.tz, ini, fin]
  );
  if (!rows.length) return null;
  const eventos = await eventosEnRango(ini, addDays(fin, -1));
  const semanaFestiva = new Set(eventos.filter((e) => TIPOS_FESTIVOS.has(e.tipo)).map((e) => inicioSemana(e.fecha)));
  let suma = 0, sumaF = 0, nF = 0;
  const productos = new Map();
  const semanas = new Set();
  for (const r of rows) {
    const err = Math.abs(r.kg - r.pred);
    suma += err;
    semanas.add(r.semana);
    if (semanaFestiva.has(r.semana)) { sumaF += err; nF++; }
    const acc = productos.get(r.id_producto) || { suma: 0, n: 0 };
    productos.set(r.id_producto, { suma: acc.suma + err, n: acc.n + 1 });
  }
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return {
    mae_general: r3(suma / rows.length),
    mae_festivos: nF ? r3(sumaF / nF) : null,
    observaciones: rows.length,
    semanas: semanas.size,
    productos: new Map([...productos].map(([id, a]) => [id, { mae: r3(a.suma / a.n), n: a.n }]))
  };
}

module.exports = { maeRespaldo, maeOperacion };
