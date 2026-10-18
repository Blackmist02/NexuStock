const fs = require('node:fs');
const { Pool, types } = require('pg');

/**
 * TLS hacia PostgreSQL (Supabase y proveedor cloud). DB_SSL:
 *  - vacío/false: sin TLS (PostgreSQL local de Docker)
 *  - requerido:   conexión cifrada sin verificar el certificado (desarrollo)
 *  - verificado:  cifrada y verificando el servidor con la CA de DB_SSL_CA (producción;
 *                 en Supabase: Database Settings → SSL Configuration → Download certificate)
 * No usar sslmode en DATABASE_URL: pg le da prioridad sobre esta configuración.
 */
function opcionesSsl() {
  const modo = (process.env.DB_SSL || '').toLowerCase();
  if (!modo || modo === 'false') return undefined;
  if (modo === 'requerido') return { rejectUnauthorized: false };
  if (modo === 'verificado') {
    if (!process.env.DB_SSL_CA) throw new Error('DB_SSL=verificado requiere DB_SSL_CA (ruta al certificado de la CA)');
    return { rejectUnauthorized: true, ca: fs.readFileSync(process.env.DB_SSL_CA, 'utf8') };
  }
  throw new Error(`DB_SSL inválido: ${modo} (usa requerido o verificado)`);
}

// NUMERIC (OID 1700) llega como string por defecto; lo convertimos a número
// (stock, cantidades y porcentajes del modelo usan NUMERIC(10,2) / NUMERIC(5,2)).
types.setTypeParser(1700, (value) => (value === null ? null : parseFloat(value)));
// BIGINT (OID 20) también llega como string; los IDs del proyecto caben en un Number.
types.setTypeParser(20, (value) => (value === null ? null : parseInt(value, 10)));

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: opcionesSsl() }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 5433,
        database: process.env.DB_NAME || 'nexustock',
        user: process.env.DB_USER || 'nexustock',
        password: process.env.DB_PASSWORD || 'nexustock_dev'
      }
);

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
