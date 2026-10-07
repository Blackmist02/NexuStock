const { Pool, types } = require('pg');

// NUMERIC (OID 1700) llega como string por defecto; lo convertimos a número
// (stock, cantidades y porcentajes del modelo usan NUMERIC(10,2) / NUMERIC(5,2)).
types.setTypeParser(1700, (value) => (value === null ? null : parseFloat(value)));
// BIGINT (OID 20) también llega como string; los IDs del proyecto caben en un Number.
types.setTypeParser(20, (value) => (value === null ? null : parseInt(value, 10)));

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
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
