const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
require('dotenv').config({ quiet: true });

const config = require('./config');
const db = require('./db');
const { authenticate, csrfGuard } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errors');

const app = express();

// Middlewares
app.set('trust proxy', config.trustProxy);
app.use(helmet());
// El frontend consume la API bajo su propio origen (proxy de Next), pero si se llama directo solo se aceptan estos orígenes
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api', csrfGuard);

// Ruta de prueba (Healthcheck) — incluye el estado de la conexión a PostgreSQL
app.get('/api/health', async (req, res) => {
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
  app.listen(config.port, () => {
    console.log(`🚀 Servidor NexuStock corriendo en http://localhost:${config.port}`);
    if (config.fechaReferencia) console.log(`📅 Fecha de referencia: ${config.fechaReferencia}`);
    iniciarTareas();
  });
  for (const senal of ['SIGINT', 'SIGTERM']) {
    process.on(senal, () => {
      require('./services/prediccion').detenerMotor();
      process.exit(0);
    });
  }
}

module.exports = app;
