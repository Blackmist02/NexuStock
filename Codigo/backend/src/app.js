const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
require('dotenv').config({ quiet: true });

const config = require('./config');
const db = require('./db');
const { authenticate, csrfGuard } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errors');
const { ApiError } = require('./lib/errors');

const app = express();

// Middlewares
app.set('trust proxy', config.trustProxy);
app.use(helmet());
// El frontend consume la API bajo su propio origen (proxy de Next), pero si se llama directo solo se aceptan estos orígenes.
// Un origen distinto se rechaza con 403. Se permiten las peticiones sin cabecera Origin (curl, healthcheck) y las del
// propio servidor (el panel de /api/health, servido por la API, llama a la API desde su mismo origen).
const mismoOrigen = (origin, host) => {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};
app.use(
  cors((req, callback) => {
    const origin = req.headers.origin;
    if (!origin || config.corsOrigins.includes(origin) || mismoOrigen(origin, req.headers.host)) {
      return callback(null, { origin: true, credentials: true });
    }
    console.warn(`[cors] origen no permitido: ${origin}`);
    callback(new ApiError(403, 'origen_no_permitido', 'Origen no permitido'));
  })
);
// /api/import acepta archivos CSV grandes y define su propio límite
const json1mb = express.json({ limit: '1mb' });
app.use((req, res, next) => (req.path.startsWith('/api/import') ? next() : json1mb(req, res, next)));
app.use(cookieParser());
app.use('/api', csrfGuard);

// Panel de la API: archivos estáticos (sin datos; los datos se piden a /api/status con sesión de administrador o TI)
const PANEL = path.join(__dirname, 'panel');
app.use('/api/panel', express.static(PANEL, { index: false, maxAge: '1h' }));
const CSP_PANEL = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join('; ');

// Healthcheck — incluye el estado de la conexión a PostgreSQL. Un navegador (Accept: text/html) recibe el panel de la
// API, que pide iniciar sesión; curl, Docker, Render y los workflows reciben siempre este JSON.
app.get('/api/health', async (req, res) => {
  res.vary('Accept');
  if (req.accepts(['json', 'html']) === 'html') {
    return res
      .set({ 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP_PANEL })
      .sendFile(path.join(PANEL, 'index.html'));
  }
  let database = 'OK';
  try {
    await db.query('SELECT 1');
  } catch (err) {
    database = 'ERROR';
  }

  res.status(database === 'OK' ? 200 : 503).json({
    status: database === 'OK' ? 'OK' : 'DEGRADED',
    message: 'Backend de NexuStock operativo',
    database,
    timestamp: new Date().toISOString()
  });
});

// Acceso público: login, crear cuenta (alta inicial) y recuperar contraseña
app.use('/api/auth', require('./routes/auth'));

// Todo lo demás requiere sesión; el control por rol se aplica dentro de cada ruta (ver README)
app.use('/api', authenticate);
app.use('/api/status', require('./routes/estado'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/products', require('./routes/products'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/predictions', require('./routes/predictions'));
app.use('/api/models', require('./routes/models'));
app.use('/api/users', require('./routes/users'));
app.use('/api/history', require('./routes/history'));
app.use('/api/events', require('./routes/events'));
app.use('/api/config', require('./routes/config'));
app.use('/api/import', require('./routes/importacion'));

// Manejo centralizado de errores (Express 5 captura los errores de handlers async)
app.use(notFoundHandler);
app.use(errorHandler);

/**
 * Tareas al iniciar y periódicas: feriados iniciales, motor predictivo y recálculo de proyecciones y alertas.
 * La primera evaluación espera a que el modelo termine de cargar (3-5 s); si no alcanza, usa el respaldo (RF-11).
 */
function iniciarTareas() {
  const { sembrarSiVacio } = require('./services/eventos');
  const { evaluar } = require('./services/alertas');
  const { iniciarMotor } = require('./services/prediccion');
  const evaluarTodo = () =>
    evaluar().catch((e) => console.error('[tareas] no se pudo recalcular las alertas:', e.message));

  setTimeout(async () => {
    try {
      const n = await sembrarSiVacio();
      if (n) console.log(`[tareas] calendario inicial cargado: ${n} feriados`);
    } catch (e) {
      console.error('[tareas] no se pudo cargar el calendario:', e.message);
    }
    try {
      if (!(await iniciarMotor(30000))) console.log('[ml] sin modelo disponible: se usa el respaldo por promedio');
    } catch (e) {
      console.error('[ml] no se pudo iniciar el motor:', e.message);
    }
    await evaluarTodo();
  }, 3000).unref();
  if (config.evaluacionCadaMin > 0) setInterval(evaluarTodo, config.evaluacionCadaMin * 60 * 1000).unref();
}

// Inicialización del servidor (solo al ejecutar `node src/app.js`; las pruebas importan `app` sin abrir el puerto)
if (require.main === module) {
  // La configuración (negocio y fecha de referencia) se lee de la base antes de atender solicitudes
  require('./lib/negocio')
    .cargar()
    .catch((e) => console.error('[configuración] no se pudo leer CONFIGURACION:', e.message))
    .finally(() => {
      app.listen(config.port, () => {
        const fechaSistema = require('./lib/fechaSistema');
        console.log(`🚀 Servidor NexuStock corriendo en http://localhost:${config.port}`);
        if (fechaSistema.referencia()) console.log(`📅 Fecha de referencia: ${fechaSistema.referencia()} (${fechaSistema.origenReferencia()})`);
        iniciarTareas();
      });
    });
  for (const senal of ['SIGINT', 'SIGTERM']) {
    process.on(senal, () => {
      require('./services/prediccion').detenerMotor();
      process.exit(0);
    });
  }
}

module.exports = app;
