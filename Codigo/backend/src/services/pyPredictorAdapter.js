/**
 * PyPredictorAdapter: proveedor de demanda basado en el modelo de ML (CU-08, CU-10 y CU-11).
 *
 * Mantiene vivo `predict.py --servidor` como proceso hijo: el modelo se carga una vez al iniciar el backend
 * (3-5 s) y cada solicitud se responde en milisegundos. Implementa la misma interfaz que el respaldo:
 *
 *   estimar(productoIds, horizonte) → Map<id_producto, { demanda, origen }>
 *
 * Reglas:
 *  - Semana objetivo: la que empieza el lunes siguiente a «hoy» si hoy es domingo; si no, la semana en curso.
 *  - Reutiliza la predicción del modelo activo ya registrada para el producto, horizonte y semana (RF-08, paso 2).
 *  - Si el motor no está listo, no responde en ML_TIMEOUT_MS o un producto no tiene historial, usa el respaldo
 *    (promedio histórico o categoría) y lo registra con su origen.
 *  - Cada predicción nueva se registra en PREDICCIONES con su latencia (CU-10).
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const readline = require('node:readline');
const config = require('../config');
const db = require('../db');
const { addDays, hoy, semanaObjetivo: fechaObjetivo } = require('../lib/dates');
const { promedioHistorico } = require('./demanda');

const SEMANAS_HISTORIAL = 8;
const DIAS_EVENTOS = 35;   // el horizonte mensual predice 4 semanas en cadena
const ARRANQUE_MS = 60000;

class PyPredictorAdapter {
  constructor({ python, script, timeoutMs }) {
    this.python = python;
    this.script = script;
    this.timeoutMs = timeoutMs;
    this.proceso = null;
    this.disponible = false;
    this.version = null;
    this.pendiente = null;
    this.cola = Promise.resolve();
  }

  /** Lanza predict.py --servidor si no está corriendo. No bloquea: mientras carga, estimar() usa el respaldo. */
  iniciar() {
    if (this.proceso) return;
    const proc = spawn(this.python, [this.script, '--servidor'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proceso = proc;
    const inicio = Date.now();
    const espera = setTimeout(() => {
      console.warn(`[ml] predict.py no estuvo listo en ${ARRANQUE_MS / 1000} s; se detiene`);
      this.detener();
    }, ARRANQUE_MS);

    readline.createInterface({ input: proc.stdout }).on('line', (linea) => {
      let msg;
      try {
        msg = JSON.parse(linea);
      } catch {
        return;
      }
      if (!this.disponible && msg.listo) {
        clearTimeout(espera);
        this.disponible = true;
        this.version = msg.version;
        console.log(`[ml] modelo ${msg.version} listo en ${Date.now() - inicio} ms`);
        return;
      }
      const p = this.pendiente;
      this.pendiente = null;
      if (p) p.resolve(msg);
    });
    proc.stderr.on('data', (d) => console.warn('[ml]', String(d).trim()));

    const terminar = (motivo) => {
      clearTimeout(espera);
      if (this.proceso !== proc) return;
      this.proceso = null;
      this.disponible = false;
      if (this.pendiente) this.pendiente.reject(new Error(motivo));
      this.pendiente = null;
    };
    proc.on('error', (err) => {
      console.warn(`[ml] no se pudo iniciar predict.py: ${err.message}`);
      terminar(err.message);
    });
    proc.on('exit', (code) => terminar(`predict.py terminó (código ${code})`));
  }

  detener() {
    if (this.proceso) this.proceso.kill();
  }

  /** Envía una solicitud al proceso (una a la vez) y espera la respuesta como máximo timeoutMs. */
  solicitar(payload) {
    const tarea = this.cola.then(
      () =>
        new Promise((resolve, reject) => {
          if (!this.disponible) return reject(new Error('motor de ML no disponible'));
          const timer = setTimeout(() => {
            this.pendiente = null;
            reject(new Error(`sin respuesta en ${this.timeoutMs} ms`));
            this.detener(); // la respuesta tardía quedaría desfasada: se reinicia el proceso
          }, this.timeoutMs);
          this.pendiente = {
            resolve: (m) => (clearTimeout(timer), resolve(m)),
            reject: (e) => (clearTimeout(timer), reject(e))
          };
          this.proceso.stdin.write(JSON.stringify(payload) + '\n');
        })
    );
    this.cola = tarea.catch(() => {});
    return tarea;
  }

  async armarSolicitud(ids, objetivo) {
    const desde = addDays(objetivo, -7 * SEMANAS_HISTORIAL);
    const [productos, ventas, eventos] = await Promise.all([
      db.query(
        `SELECT p.id_producto, c.nombre AS categoria
           FROM productos p JOIN categorias c USING (id_categoria)
          WHERE p.activo AND p.id_producto = ANY($1)`,
        [ids]
      ),
      db.query(
        `SELECT id_producto, to_char(date_trunc('week', fecha_hora AT TIME ZONE $2), 'YYYY-MM-DD') AS semana,
                SUM(cantidad)::float AS kg
           FROM ventas
          WHERE id_producto = ANY($1)
            AND fecha_hora >= ($3::date::timestamp AT TIME ZONE $2)
            AND fecha_hora <  ($4::date::timestamp AT TIME ZONE $2)
          GROUP BY 1, 2`,
        [ids, config.tz, desde, objetivo]
      ),
      db.query(
        `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, nombre, tipo
           FROM eventos_calendario
          WHERE fecha >= $1::date AND fecha < $1::date + $2::int`,
        [objetivo, DIAS_EVENTOS]
      )
    ]);
    const porProducto = new Map(productos.rows.map((p) => [p.id_producto, []]));
    for (const v of ventas.rows) porProducto.get(v.id_producto)?.push({ semana: v.semana, kg: v.kg });
    return {
      fecha_objetivo: objetivo,
      eventos: eventos.rows,
      productos: productos.rows.map((p) => ({
        producto_id: p.id_producto,
        categoria: p.categoria,
        ventas_semanales: porProducto.get(p.id_producto)
      }))
    };
  }

  async estimar(productoIds, horizonte = 'semana') {
    if (!this.proceso) this.iniciar(); // se reinicia si terminó o se detuvo por timeout
    const objetivo = fechaObjetivo(hoy());
    const modelo = (await db.query('SELECT id_modelo FROM modelos_ml WHERE activo ORDER BY id_modelo DESC LIMIT 1'))
      .rows[0];
    const idModelo = modelo ? modelo.id_modelo : null;

    // Predicciones del modelo activo ya registradas para esta semana: se reutilizan
    const previas = await db.query(
      `SELECT DISTINCT ON (id_producto) id_producto, demanda_pred
         FROM predicciones
        WHERE origen = 'modelo' AND id_modelo IS NOT DISTINCT FROM $1
          AND horizonte = $2 AND fecha_objetivo = $3::date AND id_producto = ANY($4)
        ORDER BY id_producto, generada_en DESC`,
      [idModelo, horizonte, objetivo, productoIds]
    );
    const resultado = new Map(previas.rows.map((r) => [r.id_producto, { demanda: r.demanda_pred, origen: 'modelo' }]));
    let faltan = productoIds.filter((id) => !resultado.has(id));
    if (faltan.length === 0) return resultado;

    const nuevas = [];
    try {
      if (!idModelo) throw new Error('no hay un modelo activo en MODELOS_ML');
      const solicitud = await this.armarSolicitud(faltan, objetivo);
      const inicio = Date.now();
      const resp = await this.solicitar({ ...solicitud, producto: 'todos', horizonte });
      const latencia = Date.now() - inicio;
      if (resp.error) throw new Error(resp.error);
      for (const p of resp.predicciones) {
        if (p.demanda_kg === undefined) continue; // historial_insuficiente → respaldo
        resultado.set(p.producto_id, { demanda: p.demanda_kg, origen: 'modelo' });
        nuevas.push([p.producto_id, idModelo, p.demanda_kg, 'modelo', latencia]);
      }
    } catch (err) {
      console.warn(`[ml] se usa el respaldo: ${err.message}`);
    }

    faltan = faltan.filter((id) => !resultado.has(id));
    if (faltan.length) {
      const respaldo = await promedioHistorico.estimar(faltan, horizonte);
      for (const [id, e] of respaldo) {
        resultado.set(id, e);
        nuevas.push([id, null, e.demanda, e.origen, null]);
      }
    }
    await registrar(nuevas, horizonte, objetivo);
    return resultado;
  }
}

/** Inserta las predicciones nuevas (CU-10). No duplica producto, horizonte, semana y origen. */
async function registrar(filas, horizonte, objetivo) {
  if (!filas.length) return;
  const [ids, modelos, demandas, origenes, latencias] = [0, 1, 2, 3, 4].map((i) => filas.map((f) => f[i]));
  await db.query(
    `INSERT INTO predicciones (id_producto, id_modelo, horizonte, fecha_objetivo, demanda_pred, origen, latencia_ms)
     SELECT n.id_producto, n.id_modelo, $6::varchar, $7::date, n.demanda, n.origen, n.latencia
       FROM unnest($1::bigint[], $2::bigint[], $3::numeric[], $4::varchar[], $5::int[])
            AS n(id_producto, id_modelo, demanda, origen, latencia)
      WHERE NOT EXISTS (SELECT 1 FROM predicciones p
                         WHERE p.id_producto = n.id_producto AND p.horizonte = $6::varchar
                           AND p.fecha_objetivo = $7::date AND p.origen = n.origen)`,
    [ids, modelos, demandas, origenes, latencias, horizonte, objetivo]
  );
}

/** Crea el adaptador si el motor está habilitado y el script existe; si no, el sistema sigue con el respaldo. */
function crearPyPredictor() {
  const { habilitado, python, script, timeoutMs } = config.ml;
  if (!habilitado) return null;
  if (!fs.existsSync(script)) {
    console.warn(`[ml] no se encontró ${script}; se usa el respaldo por promedio`);
    return null;
  }
  const adaptador = new PyPredictorAdapter({ python, script, timeoutMs });
  adaptador.iniciar();
  return adaptador;
}

module.exports = { PyPredictorAdapter, crearPyPredictor, fechaObjetivo };
