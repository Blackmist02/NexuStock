// Estado técnico del sistema para el panel de la API (/api/health en el navegador). Solo administrador y TI (RF-07).
// No expone secretos: de la configuración sensible solo informa si está definida.
const fs = require('node:fs');
const express = require('express');
const config = require('../config');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const fechaSistema = require('../lib/fechaSistema');
const negocio = require('../lib/negocio');
const prediccion = require('../services/prediccion');
const { version } = require('../../package.json');

const router = express.Router();
const INICIO = new Date().toISOString();

async function estadoBase() {
  const inicio = Date.now();
  try {
    const { rows } = await db.query(`
      SELECT current_setting('server_version') AS version,
             (SELECT COUNT(*) FROM productos)::int    AS productos,
             (SELECT COUNT(*) FROM proveedores)::int  AS proveedores,
             (SELECT COUNT(*) FROM ventas)::int       AS ventas,
             (SELECT COUNT(*) FROM compras)::int      AS compras,
             (SELECT COUNT(*) FROM mermas)::int       AS mermas,
             (SELECT COUNT(*) FROM predicciones)::int AS predicciones,
             (SELECT COUNT(*) FROM alertas_inventario WHERE estado = 'activa')::int AS alertas_activas,
             (SELECT COUNT(*) FROM usuarios WHERE activo)::int AS usuarios_activos`);
    const { version: v, ...tablas } = rows[0];
    return { estado: 'OK', latencia_ms: Date.now() - inicio, version: `PostgreSQL ${v}`, tablas };
  } catch (e) {
    console.error('[estado] base de datos:', e.message);
    return { estado: 'ERROR', latencia_ms: Date.now() - inicio, version: null, tablas: null };
  }
}

async function estadoMotor() {
  try {
    const m = await prediccion.modeloActivo();
    const motor = prediccion.estadoMotor();
    return {
      estado: m && motor.disponible ? 'OK' : 'RESPALDO',
      proceso: motor.disponible ? 'listo' : 'detenido',
      version_cargada: motor.version,
      script_presente: fs.existsSync(prediccion.scriptPredict()),
      modelo: m && {
        algoritmo: m.algoritmo,
        version: m.version,
        mae_general: Number(m.mae_general),
        mae_festivos: Number(m.mae_festivos),
        artefacto: m.artefacto_ruta,
        artefacto_presente: prediccion.artefactoExiste(m.artefacto_ruta)
      }
    };
  } catch (e) {
    console.error('[estado] motor:', e.message);
    return { estado: 'ERROR', proceso: 'desconocido', version_cargada: null, script_presente: false, modelo: null };
  }
}

router.get('/', requireRole('administrador', 'ti'), async (req, res) => {
  const [base, motor] = await Promise.all([estadoBase(), estadoMotor()]);
  const mem = process.memoryUsage();
  res.set('Cache-Control', 'no-store').json({
    estado: base.estado === 'OK' ? 'OK' : 'DEGRADADO',
    generado: new Date().toISOString(),
    usuario: { nombre: req.user.nombre, rol: req.user.rol },
    api: {
      estado: 'OK',
      version,
      node: process.version,
      entorno: config.isProd ? 'producción' : 'desarrollo',
      iniciado: INICIO,
      uptime_s: Math.round(process.uptime()),
      memoria_mb: Math.round(mem.rss / 1048576),
      commit: (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').slice(0, 7) || null,
      servicio: process.env.RENDER_SERVICE_NAME || null
    },
    base,
    motor,
    configuracion: {
      negocio: negocio.leer()?.nombre || null,
      fecha_referencia: fechaSistema.referencia() || null,
      origen_fecha: fechaSistema.origenReferencia(),
      zona_horaria: config.tz,
      origenes_cors: config.corsOrigins,
      cookie_segura: config.cookieSecure,
      proxies_confiables: config.trustProxy,
      limite_intentos_login: config.authRateLimit,
      evaluacion_cada_min: config.evaluacionCadaMin,
      timeout_motor_ms: config.ml.timeoutMs,
      correo_configurado: !!config.smtpUrl,
      registro_publico: config.allowPublicSignup
    }
  });
});

module.exports = router;
