/**
 * Serie de demanda real y proyectada de uno o varios productos (gráfico de Predicción y tendencia del Dashboard).
 *  - Semanas pasadas: venta real y la predicción semanal registrada en PREDICCIONES (hecha solo con ventas anteriores).
 *  - Desde la semana en curso: proyección semana a semana con el modelo activo (predict.py, horizonte 'serie'); los
 *    productos que el modelo no puede proyectar usan el respaldo (RF-11), que repite su demanda semanal.
 * Con varios productos se suman los kg (solo productos por kilo). La semana se reparte entre los días con PESOS_DIA.
 */
const config = require('../config');
const db = require('../db');
const { addDays, addMonths, diffDays, hoy, inicioSemana, isoWeekday } = require('../lib/dates');
const { promedioHistorico } = require('./demanda');
const { modeloActivo, modeloDisponible, proyectarSerie } = require('./prediccion');
const { PESOS_DIA } = require('./reglas');
const { eventosEnRango } = require('./eventos');

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Proyección de `n` semanas desde la semana en curso para los productos de `snaps` (filas de snapshotInventario).
 * Devuelve { porProducto: Map<id, [{ semana, demanda }]>, origen: 'modelo' | 'mixto' | 'promedio_historico' |
 * 'categoria', latencia_ms }.
 */
async function proyeccionSemanal(snaps, n) {
  const lunesHoy = inicioSemana(hoy());
  let porProducto = new Map();
  let latencia = null;
  const modelo = await modeloDisponible().catch(() => null);
  if (modelo && snaps.length) {
    try {
      const r = await proyectarSerie(snaps, n, modelo);
      porProducto = r.porProducto;
      latencia = r.latencia_ms;
    } catch (e) {
      console.warn(`[predicción] serie con respaldo: ${e.message}`);
    }
  }
  const faltan = snaps.filter((s) => !porProducto.has(s.id_producto));
  // Si el producto venía proyectado por el modelo y la serie falló, el respaldo es el promedio histórico
  const promedios = faltan.some((s) => s.origen_demanda === 'modelo')
    ? await promedioHistorico.estimar(faltan.map((s) => s.id_producto), 'semana')
    : new Map();
  const origenes = new Set(snaps.filter((s) => porProducto.has(s.id_producto)).map(() => 'modelo'));
  for (const s of faltan) {
    const base = s.origen_demanda === 'modelo' ? promedios.get(s.id_producto)?.demanda ?? s.demanda_semana : s.demanda_semana;
    origenes.add(s.origen_demanda === 'modelo' ? 'promedio_historico' : s.origen_demanda);
    porProducto.set(s.id_producto, Array.from({ length: n }, (_, k) => ({ semana: addDays(lunesHoy, 7 * k), demanda: r2(base) })));
  }
  const origen = origenes.size === 1 ? [...origenes][0] : origenes.has('modelo') ? 'mixto' : 'promedio_historico';
  return { porProducto, origen, latencia_ms: latencia };
}

/** Serie para el gráfico: de `atras` meses antes a `adelante` meses después de hoy, en semanas completas. */
async function construirSerie(snaps, atras, adelante) {
  const hoyIso = hoy();
  const lunesHoy = inicioSemana(hoyIso);
  const desde = inicioSemana(addMonths(hoyIso, -atras));
  const hasta = addDays(inicioSemana(addMonths(hoyIso, adelante)), 6);
  const nFuturas = Math.round((diffDays(hasta, lunesHoy) + 1) / 7);
  const ids = snaps.map((s) => s.id_producto);

  const [hist, registradas, futuras, eventos, activo] = await Promise.all([
    db.query(
      `SELECT to_char((fecha_hora AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha, SUM(cantidad)::float AS kg
         FROM ventas
        WHERE id_producto = ANY($1::bigint[])
          AND fecha_hora >= ($3::date::timestamp AT TIME ZONE $2)
          AND fecha_hora <  (($4::date + 1)::timestamp AT TIME ZONE $2)
        GROUP BY 1`,
      [ids, config.tz, desde, hoyIso]
    ),
    // Última predicción registrada de cada producto y semana (prefiere la del modelo); se suman por semana
    db.query(
      `SELECT semana, SUM(kg)::float AS kg, COUNT(*)::int AS productos FROM (
         SELECT DISTINCT ON (id_producto, fecha_objetivo) id_producto, to_char(fecha_objetivo, 'YYYY-MM-DD') AS semana, demanda_pred AS kg
           FROM predicciones
          WHERE id_producto = ANY($1::bigint[]) AND horizonte = 'semana' AND fecha_objetivo >= $2::date AND fecha_objetivo < $3::date
          ORDER BY id_producto, fecha_objetivo, (origen = 'modelo') DESC, generada_en DESC
       ) t GROUP BY semana`,
      [ids, desde, lunesHoy]
    ),
    proyeccionSemanal(snaps, nFuturas),
    eventosEnRango(desde, hasta),
    modeloActivo().catch(() => null)
  ]);

  const proySemana = new Map(registradas.rows.map((r) => [r.semana, r.kg]));
  for (const serie of futuras.porProducto.values()) {
    for (const f of serie) proySemana.set(f.semana, (proySemana.get(f.semana) ?? 0) + f.demanda);
  }
  const real = new Map(hist.rows.map((r) => [r.fecha, r.kg]));

  const dias = [];
  for (let f = desde; f <= hasta; f = addDays(f, 1)) {
    const ps = proySemana.get(inicioSemana(f));
    const kgReal = real.get(f);
    dias.push({
      fecha: f,
      real: f < hoyIso ? r2(kgReal ?? 0) : f === hoyIso && kgReal > 0 ? r2(kgReal) : null,
      proyectada: ps != null ? r2(ps * PESOS_DIA[isoWeekday(f) - 1]) : null
    });
  }
  const semanas = [];
  for (let s = desde; s <= hasta; s = addDays(s, 7)) {
    const ps = proySemana.get(s);
    const conDato = dias.filter((d) => d.fecha >= s && d.fecha <= addDays(s, 6) && d.real !== null);
    semanas.push({
      semana: s,
      tipo: s < lunesHoy ? 'pasada' : s === lunesHoy ? 'en_curso' : 'futura',
      real: conDato.length ? r2(conDato.reduce((a, d) => a + d.real, 0)) : null,
      proyectada: ps != null ? r2(ps) : null
    });
  }
  const comparables = semanas.filter((s) => s.tipo === 'pasada' && s.real !== null && s.proyectada !== null);

  return {
    hoy: hoyIso,
    desde,
    hasta,
    atras,
    adelante,
    productos: snaps.length,
    origen_proyeccion: futuras.origen,
    latencia_ms: futuras.latencia_ms,
    mae_modelo_semana: activo ? Number(activo.mae_general) : null,
    precision_periodo: comparables.length
      ? { semanas: comparables.length, mae_semana: r2(comparables.reduce((a, s) => a + Math.abs(s.real - s.proyectada), 0) / comparables.length) }
      : null,
    dias,
    semanas,
    eventos: eventos.filter((e) => e.tipo !== 'quincena' && e.tipo !== 'fin_de_mes')
  };
}

module.exports = { proyeccionSemanal, construirSerie };
