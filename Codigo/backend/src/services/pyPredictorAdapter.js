/**
 * PyPredictorAdapter: mantiene vivo `predict.py --servidor` como proceso hijo (child_process).
 *
 * Importar pandas y scikit-learn y cargar el modelo toma 3-5 s, más que el límite de 2,0 s de una predicción (RNF).
 * Por eso el proceso se lanza una vez, carga el artefacto del modelo activo y luego responde cada solicitud en
 * milisegundos (una línea JSON por solicitud). Si se activa otro modelo, el proceso se reinicia con su artefacto.
 * La lógica de negocio (qué datos se envían y cómo se registra la predicción) está en prediccion.js.
 */
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const ARRANQUE_MS = 60000;

class PyPredictorAdapter {
  constructor({ python, script, timeoutMs }) {
    this.python = python;
    this.script = script;
    this.timeoutMs = timeoutMs;
    this.proceso = null;
    this.artefacto = null;
    this.disponible = false;
    this.version = null;
    this.pendiente = null;
    this.cola = Promise.resolve();
    this.esperas = [];
  }

  /** Lanza el proceso con el artefacto indicado (o lo reinicia si cambió). No bloquea. */
  usar(artefacto) {
    if (this.proceso && this.artefacto === artefacto) return;
    this.detener();
    this.artefacto = artefacto;
    const proc = spawn(this.python, [this.script, '--servidor'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, NEXUSTOCK_MODELO: artefacto }
    });
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
        this.esperas.splice(0).forEach((r) => r(true));
        return;
      }
      const p = this.pendiente;
      this.pendiente = null;
      if (p) p.resolve(msg);
    });
    // El detalle técnico queda solo en el log del servidor (RNF-08)
    proc.stderr.on('data', (d) => console.warn('[ml]', String(d).trim().slice(0, 300)));

    const terminar = (motivo) => {
      clearTimeout(espera);
      if (this.proceso !== proc) return;
      this.proceso = null;
      this.disponible = false;
      if (this.pendiente) this.pendiente.reject(new Error(motivo));
      this.pendiente = null;
      this.esperas.splice(0).forEach((r) => r(false));
    };
    proc.on('error', (err) => {
      console.warn(`[ml] no se pudo iniciar predict.py: ${err.message}`);
      terminar(err.message);
    });
    proc.on('exit', (code) => terminar(`predict.py terminó (código ${code})`));
    proc.stdin.on('error', () => {});
  }

  /** Resuelve true cuando el modelo está cargado (false si el proceso falla o se cumple el plazo). */
  esperarListo(ms = ARRANQUE_MS) {
    if (this.disponible) return Promise.resolve(true);
    if (!this.proceso) return Promise.resolve(false);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), ms);
      this.esperas.push((ok) => {
        clearTimeout(t);
        resolve(ok);
      });
    });
  }

  detener() {
    const proc = this.proceso;
    this.proceso = null;
    this.disponible = false;
    if (proc) proc.kill();
  }

  /** Envía una solicitud (una a la vez) y espera la respuesta como máximo timeoutMs. */
  solicitar(payload) {
    const tarea = this.cola.then(
      () =>
        new Promise((resolve, reject) => {
          if (!this.disponible) return reject(new Error('motor_no_disponible'));
          const timer = setTimeout(() => {
            this.pendiente = null;
            reject(new Error('tiempo_agotado'));
            // Una respuesta tardía quedaría desfasada: se reinicia el proceso con el mismo artefacto
            const artefacto = this.artefacto;
            this.detener();
            this.usar(artefacto);
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
}

module.exports = { PyPredictorAdapter };
