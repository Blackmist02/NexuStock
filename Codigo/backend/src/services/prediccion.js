/**
 * Adaptador del motor predictivo (RF-08, RF-10, RF-11). La API usa `ml-engine/predict.py` como proceso hijo
 * persistente (PyPredictorAdapter, modo --servidor) con el artefacto del modelo activo; si no hay modelo, el motor
 * no está listo, falla o tarda más de 2 s, el llamador aplica el respaldo por promedio histórico o por categoría (RF-11).
 *
 * Contrato con el script (ver ml-engine/README.md): una línea JSON por solicitud
 *   { fecha_objetivo, producto: 'todos', horizonte, eventos: [{fecha, nombre, tipo}],
 *     productos: [{ producto_id, categoria, ventas_semanales: [{semana, kg}] }] }
 *   → { predicciones: [{ producto_id, demanda_kg } | { producto_id, error }], mae, latencia_ms, version }
 * Con horizonte 'serie' la solicitud agrega `semanas` y cada predicción trae `semanas: [{ semana, demanda_kg }]`.
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const db = require('../db');
const { addDays, hoy, inicioMes, inicioSemana } = require('../lib/dates');
const { PyPredictorAdapter } = require('./pyPredictorAdapter');

const DIAS = { semana: 7, mes: 30 };
const SEMANAS_HISTORIAL = 8;
const DIAS_EVENTOS = 35; // el horizonte mensual predice 4 semanas en cadena
const SEMANAS_SERIE_MAX = 26;

/** Fecha objetivo del ciclo: lunes de la semana en curso o primer día del mes. */
const fechaObjetivo = (horizonte, hoyIso = hoy()) => (horizonte === 'mes' ? inicioMes(hoyIso) : inicioSemana(hoyIso));

const scriptPredict = () => config.ml.script || path.join(config.ml.dir, 'predict.py');

const motor = new PyPredictorAdapter({ python: config.ml.python, script: scriptPredict(), timeoutMs: config.ml.timeoutMs });

async function modeloActivo() {
  const { rows } = await db.query('SELECT * FROM modelos_ml WHERE activo LIMIT 1');
  return rows[0] || null;
}

/** Resuelve la ruta del artefacto dentro de ml-engine (evita salir de la carpeta con «..»). */
function resolverArtefacto(ruta) {
  const base = path.resolve(config.ml.dir);
  const abs = path.resolve(base, ruta);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

const artefactoExiste = (ruta) => {
  const abs = resolverArtefacto(ruta);
  return !!abs && fs.existsSync(abs) && fs.statSync(abs).isFile();
};

/** ¿Se puede usar el modelo? Requiere modelo activo, artefacto presente y script disponible. */
async function modeloDisponible() {
  const m = await modeloActivo();
  if (!m || !fs.existsSync(scriptPredict()) || !artefactoExiste(m.artefacto_ruta)) return null;
  return m;
}

/**
 * Lanza el motor con el artefacto del modelo activo y espera a que esté listo (al iniciar el backend).
 * Devuelve false si no hay modelo disponible o no alcanzó a cargar.
 */
async function iniciarMotor(esperaMs) {
  const modelo = await modeloDisponible();
  if (!modelo) return false;
  motor.usar(resolverArtefacto(modelo.artefacto_ruta));
  return motor.esperarListo(esperaMs);
}

const detenerMotor = () => motor.detener();

/**
 * Proyección de varios productos con el modelo activo en una sola solicitud.
 * Devuelve Map<id_producto, { demanda, origen: 'modelo', id_modelo, latencia_ms }> con los productos que el modelo
 * pudo proyectar; los que no (sin historial o valor no viable, RNF-15) quedan fuera y el llamador usa el respaldo.
 * Lanza un Error si el motor no está disponible, falla o supera el tiempo máximo.
 */
async function predecirLote(productos, horizonte, modelo) {
  const lunes = inicioSemana(fechaObjetivo(horizonte));
  const { resp, latencia } = await consultarMotor(productos, horizonte, modelo, lunes, DIAS_EVENTOS);
  const tope = config.ml.capacidadKgSemana * (horizonte === 'mes' ? 4.5 : 1);
  const out = new Map();
  for (const r of resp.predicciones) {
    const demanda = Number(r.demanda_kg);
    if (r.error || !Number.isFinite(demanda) || demanda < 0 || demanda > tope) continue;
    out.set(Number(r.producto_id), {
      demanda: Math.round(demanda * 100) / 100,
      origen: 'modelo',
      id_modelo: modelo.id_modelo,
      latencia_ms: latencia
    });
  }
  return out;
}

/**
 * Proyección semana a semana de varios productos desde la semana en curso, en una sola solicitud (horizonte 'serie' de
 * predict.py): cada semana usa las anteriores como lags. Devuelve { porProducto: Map<id, [{ semana, demanda }]>,
 * latencia_ms }; los productos sin historial o con alguna semana no viable quedan fuera (el llamador usa el respaldo).
 * Lanza un Error si el motor no está disponible, falla o supera el tiempo máximo.
 */
async function proyectarSerie(productos, semanas, modelo) {
  const n = Math.min(SEMANAS_SERIE_MAX, Math.max(1, semanas));
  const lunes = inicioSemana(hoy());
  const { resp, latencia } = await consultarMotor(productos, 'serie', modelo, lunes, 7 * (n + 1), { semanas: n });
  const porProducto = new Map();
  for (const r of resp.predicciones) {
    if (r.error || !Array.isArray(r.semanas) || r.semanas.length !== n) continue;
    const serie = r.semanas.map((s) => ({ semana: s.semana, demanda: Number(s.demanda_kg) }));
    if (serie.some((s) => !Number.isFinite(s.demanda) || s.demanda < 0 || s.demanda > config.ml.capacidadKgSemana)) continue;
    porProducto.set(Number(r.producto_id), serie.map((s) => ({ ...s, demanda: Math.round(s.demanda * 100) / 100 })));
  }
  return { porProducto, latencia_ms: latencia };
}

/** Arma la solicitud (8 semanas de ventas previas a `lunes` y eventos de `diasEventos` días) y consulta al motor. */
async function consultarMotor(productos, horizonte, modelo, lunes, diasEventos, extra = {}) {
  motor.usar(resolverArtefacto(modelo.artefacto_ruta)); // si cambió el modelo activo, se reinicia con el nuevo
  if (!motor.disponible) throw new Error('motor_no_disponible');
  const ids = productos.map((p) => p.id_producto);
  const [ventas, eventos] = await Promise.all([
    db.query(
      `SELECT id_producto, to_char(date_trunc('week', fecha_hora AT TIME ZONE $2), 'YYYY-MM-DD') AS semana,
              SUM(cantidad)::float AS kg
         FROM ventas
        WHERE id_producto = ANY($1::bigint[])
          AND fecha_hora >= ($3::date::timestamp AT TIME ZONE $2)
          AND fecha_hora <  ($4::date::timestamp AT TIME ZONE $2)
        GROUP BY 1, 2`,
      [ids, config.tz, addDays(lunes, -7 * SEMANAS_HISTORIAL), lunes]
    ),
    db.query(
      `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, nombre, tipo FROM eventos_calendario
        WHERE fecha >= $1::date AND fecha < $1::date + $2::int ORDER BY fecha`,
      [lunes, diasEventos]
    )
  ]);
  const porProducto = new Map(ids.map((id) => [id, []]));
  for (const v of ventas.rows) porProducto.get(v.id_producto)?.push({ semana: v.semana, kg: v.kg });

  const inicio = Date.now();
  const resp = await motor.solicitar({
    ...extra,
    fecha_objetivo: lunes,
    producto: 'todos',
    horizonte,
    eventos: eventos.rows,
    productos: productos.map((p) => ({
      producto_id: p.id_producto,
      categoria: p.categoria,
      ventas_semanales: porProducto.get(p.id_producto)
    }))
  });
  if (resp.error || !Array.isArray(resp.predicciones)) throw new Error('salida_invalida');
  return { resp, latencia: Date.now() - inicio };
}

/** Proyección de un producto con el modelo activo. Lanza un Error si no se puede (el llamador usa el respaldo). */
async function predecirConModelo(producto, horizonte, modelo) {
  const r = (await predecirLote([producto], horizonte, modelo)).get(producto.id_producto);
  if (!r) throw new Error('sin_proyeccion');
  return r;
}

module.exports = {
  DIAS,
  fechaObjetivo,
  modeloActivo,
  modeloDisponible,
  predecirLote,
  predecirConModelo,
  proyectarSerie,
  iniciarMotor,
  detenerMotor,
  artefactoExiste,
  resolverArtefacto,
  scriptPredict
};
