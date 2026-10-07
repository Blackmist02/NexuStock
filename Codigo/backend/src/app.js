const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
require('dotenv').config({ quiet: true });

const config = require('./config');
const db = require('./db');
const { authenticate, csrfGuard } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errors');
const authRouter = require('./routes/auth');
const dashboardRouter = require('./routes/dashboard');

const app = express();
const PORT = config.port;

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

// Autenticación (login, crear cuenta, recuperar contraseña) y dashboard
app.use('/api/auth', authRouter);
app.use('/api/dashboard', authenticate, dashboardRouter);

// Productos activos con su categoría y proveedor
app.get('/api/products', async (req, res) => {
  const { rows } = await db.query(`
    SELECT p.id_producto,
           p.nombre,
           p.unidad,
           p.precio_venta_clp,
           p.stock_actual,
           p.stock_minimo,
           p.vida_util_dias,
           p.margen_seguridad_pct,
           c.id_categoria,
           c.nombre  AS categoria,
           pr.id_proveedor,
           pr.nombre AS proveedor
    FROM productos p
    JOIN categorias  c  ON c.id_categoria  = p.id_categoria
    JOIN proveedores pr ON pr.id_proveedor = p.id_proveedor
    WHERE p.activo
    ORDER BY p.nombre
  `);
  res.json({ data: rows });
});

// Detalle de un producto
app.get('/api/products/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID de producto inválido' });
  }

  const { rows } = await db.query(`
    SELECT p.*,
           c.nombre  AS categoria,
           pr.nombre AS proveedor
    FROM productos p
    JOIN categorias  c  ON c.id_categoria  = p.id_categoria
    JOIN proveedores pr ON pr.id_proveedor = p.id_proveedor
    WHERE p.id_producto = $1
  `, [id]);

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Producto no encontrado' });
  }
  res.json({ data: rows[0] });
});

// Categorías
app.get('/api/categories', async (req, res) => {
  const { rows } = await db.query(
    'SELECT id_categoria, nombre FROM categorias ORDER BY nombre'
  );
  res.json({ data: rows });
});

// Proveedores activos
app.get('/api/suppliers', async (req, res) => {
  const { rows } = await db.query(`
    SELECT id_proveedor, nombre, contacto, lead_time_dias, dias_habiles
    FROM proveedores
    WHERE activo
    ORDER BY nombre
  `);
  res.json({ data: rows });
});

// Manejo centralizado de errores (Express 5 captura los errores de handlers async)
app.use(notFoundHandler);
app.use(errorHandler);

// Inicialización del servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor NexuStock corriendo en http://localhost:${PORT}`);
});
