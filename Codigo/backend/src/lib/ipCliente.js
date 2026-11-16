/**
 * IP real del cliente para el límite de intentos (RNF-09, defecto DEF-02 de la tarea 28).
 *
 * En la demo hay varios proxies delante de la API (Vercel → Cloudflare → balanceador de Render) y su número cambia según
 * por dónde llegue la petición, así que `req.ip` con un `trust proxy` fijo terminaba siendo la IP de un proxy que rota.
 * Orden de confianza:
 *   1. `x-nx-cliente-ip`, solo si viene con `x-nx-proxy-secreto` = PROXY_SECRET. La pone el proxy de Next (frontend),
 *      que toma la IP que Vercel informa y que el cliente no puede falsear. Sin el secreto, la cabecera se ignora.
 *   2. `cf-connecting-ip`, solo con TRUST_CF_CONNECTING_IP=true (API publicada detrás de Cloudflare, como en Render:
 *      Cloudflare sobrescribe esa cabecera con la IP que se le conectó). Cubre las llamadas directas a la API.
 *   3. `req.ip` (según TRUST_PROXY), como antes.
 */
const crypto = require('node:crypto');
const net = require('node:net');

const CABECERA_IP = 'x-nx-cliente-ip';
const CABECERA_SECRETO = 'x-nx-proxy-secreto';

/** Comparación en tiempo constante (no revela cuántos caracteres del secreto coinciden). */
function mismoSecreto(recibido, esperado) {
  if (typeof recibido !== 'string' || !esperado) return false;
  const a = crypto.createHash('sha256').update(recibido).digest();
  const b = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}

const ipValida = (v) => (typeof v === 'string' && net.isIP(v.trim()) ? v.trim() : null);

/** Devuelve la IP del cliente según el orden de confianza descrito arriba. */
function ipCliente(req, { secreto = '', confiarCloudflare = false } = {}) {
  const h = req.headers || {};
  if (secreto && mismoSecreto(h[CABECERA_SECRETO], secreto)) {
    const ip = ipValida(h[CABECERA_IP]);
    if (ip) return ip;
  }
  if (confiarCloudflare) {
    const ip = ipValida(h['cf-connecting-ip']);
    if (ip) return ip;
  }
  return req.ip;
}

module.exports = { ipCliente, CABECERA_IP, CABECERA_SECRETO };
