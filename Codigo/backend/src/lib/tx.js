const db = require('../db');

// Errores de conexión / reinicio de PostgreSQL / deadlocks que conviene reintentar (RNF-12)
const TRANSITORIOS = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND',
  '57P01', '57P02', '57P03', '08000', '08001', '08003', '08006', '40001', '40P01'
]);
const esTransitorio = (e) => !!e && (TRANSITORIOS.has(e.code) || /Connection terminated|timeout exceeded when trying to connect/i.test(e.message || ''));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ejecuta `fn(client)` dentro de una transacción atómica (RNF-11). Si falla por una causa transitoria
 * de la base de datos, revierte y reintenta de forma transparente (RNF-12); si no se logra, propaga el error.
 */
async function withTransaction(fn, { reintentos = 2 } = {}) {
  for (let intento = 0; ; intento++) {
    let client;
    let roto = false;
    try {
      client = await db.pool.connect();
      await client.query('BEGIN');
      const resultado = await fn(client);
      await client.query('COMMIT');
      return resultado;
    } catch (e) {
      if (client) await client.query('ROLLBACK').catch(() => { roto = true; });
      if (esTransitorio(e) && intento < reintentos) {
        roto = true;
        await dormir(200 * (intento + 1));
        continue;
      }
      throw e;
    } finally {
      if (client) client.release(roto || undefined);
    }
  }
}

module.exports = { withTransaction, esTransitorio };
