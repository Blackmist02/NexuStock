/**
 * Adaptador del motor predictivo (RF-08, RF-10, RF-11). La API invoca el script de Python como proceso hijo
 * (child_process.spawn, no bloqueante) con el modelo activo; si no hay modelo, falla o tarda más de 2 s, el
 * llamador aplica el respaldo por promedio histórico o por categoría (RF-11).
 *
 * Contrato del script (ver ml-engine/README.md):
 *   argumentos: <script> <id_producto> <horizonte: semana|mes>
 *   stdin  (JSON): { producto, horizonte, fecha_objetivo, artefacto, ventas: [{fecha, cantidad}], eventos: [{fecha, nombre, tipo}] }
 *   stdout (JSON): { demanda_kg, mae, latencia_ms }
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const db = require('../db');
const { addDays, hoy, inicioMes, inicioSemana } = require('../lib/dates');

const MAX_SALIDA = 64 * 1024;
const DIAS = { semana: 7, mes: 30 };

/** Fecha objetivo del ciclo: lunes de la semana en curso o primer día del mes. */
const fechaObjetivo = (horizonte, hoyIso = hoy()) => (horizonte === 'mes' ? inicioMes(hoyIso) : inicioSemana(hoyIso));

const scriptPredict = () => config.ml.script || path.join(config.ml.dir, 'predict.py');

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

function ejecutarScript(args, entrada, timeoutMs) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(config.ml.python, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    let terminado = false;
    const fin = (fn, valor) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      fn(valor);
    };
    const timer = setTimeout(() => {
      hijo.kill('SIGKILL');
      fin(reject, new Error('tiempo_agotado'));
    }, timeoutMs);
    hijo.stdout.on('data', (d) => {
      out += d;
      if (out.length > MAX_SALIDA) {
        hijo.kill('SIGKILL');
        fin(reject, new Error('salida_excesiva'));
      }
    });
    hijo.stderr.on('data', (d) => {
      if (err.length < MAX_SALIDA) err += d;
    });
    hijo.on('error', (e) => fin(reject, e));
    hijo.on('close', (code) => {
      if (code !== 0 || err.trim()) {
        // El detalle técnico queda solo en el log del servidor (RNF-08)
        console.error(`[ml] el script terminó con código ${code}: ${err.replace(/\s+/g, ' ').slice(0, 300)}`);
        return fin(reject, new Error('script_fallido'));
      }
      fin(resolve, out);
    });
    hijo.stdin.on('error', () => {});
    hijo.stdin.end(JSON.stringify(entrada));
  });
}

/** ¿Se puede usar el modelo? Requiere modelo activo, artefacto presente y script disponible. */
async function modeloDisponible() {
  const m = await modeloActivo();
  if (!m || !fs.existsSync(scriptPredict()) || !artefactoExiste(m.artefacto_ruta)) return null;
  return m;
}

/**
 * Proyección de un producto con el modelo activo. Lanza un Error si no se puede (el llamador usa el respaldo).
 * Valida que el valor sea numérico, no negativo y acotado a la capacidad del local (RNF-15).
 */
async function predecirConModelo(producto, horizonte, modelo) {
  const objetivo = fechaObjetivo(horizonte);
  const dias = DIAS[horizonte];
  const [ventas, eventos] = await Promise.all([
    db.query(
      `SELECT to_char((fecha_hora AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS fecha, SUM(cantidad)::float AS cantidad
         FROM ventas WHERE id_producto = $1 AND fecha_hora >= NOW() - interval '120 days' GROUP BY 1 ORDER BY 1`,
      [producto.id_producto, config.tz]
    ),
    db.query(
      `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, nombre, tipo FROM eventos_calendario
        WHERE fecha BETWEEN $1::date - 120 AND $2::date ORDER BY fecha`,
      [objetivo, addDays(objetivo, dias)]
    )
  ]);
  const inicio = Date.now();
  const salida = await ejecutarScript(
    [scriptPredict(), String(producto.id_producto), horizonte],
    {
      producto: { id_producto: producto.id_producto, nombre: producto.nombre, categoria: producto.categoria, unidad: producto.unidad },
      horizonte,
      fecha_objetivo: objetivo,
      artefacto: resolverArtefacto(modelo.artefacto_ruta),
      ventas: ventas.rows,
      eventos: eventos.rows
    },
    config.ml.timeoutMs
  );
  let json;
  try {
    json = JSON.parse(salida);
  } catch {
    throw new Error('salida_invalida');
  }
  const demanda = Number(json.demanda_kg);
  const tope = config.ml.capacidadKgSemana * (horizonte === 'mes' ? 4.5 : 1);
  if (!Number.isFinite(demanda) || demanda < 0 || demanda > tope) throw new Error('valor_invalido');
  const latencia = Number.isFinite(Number(json.latencia_ms)) ? Math.round(Number(json.latencia_ms)) : Date.now() - inicio;
  return { demanda: Math.round(demanda * 100) / 100, origen: 'modelo', id_modelo: modelo.id_modelo, latencia_ms: latencia };
}

module.exports = { DIAS, fechaObjetivo, modeloActivo, modeloDisponible, predecirConModelo, artefactoExiste, resolverArtefacto, scriptPredict };
