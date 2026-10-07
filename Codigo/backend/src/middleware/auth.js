const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { forbidden, unauthorized } = require('../lib/errors');
const { fingerprint } = require('../lib/password');

const COOKIE_NAME = 'nx_token';
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' };

/** Token de acceso. `pv` es la huella de la contraseña vigente: si la contraseña cambia, el token deja de servir. */
function signAccessToken(user) {
  return jwt.sign({ sub: String(user.id_usuario), pv: fingerprint(user.password_hash), typ: 'access' }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256'
  });
}

const setAuthCookie = (res, token) => res.cookie(COOKIE_NAME, token, { ...cookieOpts, maxAge: 24 * 60 * 60 * 1000 });
const clearAuthCookie = (res) => res.clearCookie(COOKIE_NAME, cookieOpts);

/** Lee el JWT (cookie httpOnly o cabecera Bearer) y carga el usuario vigente desde la BD. */
async function authenticate(req, _res, next) {
  try {
    let token;
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) token = header.slice(7);
    else if (req.cookies && req.cookies[COOKIE_NAME]) token = req.cookies[COOKIE_NAME];
    if (!token) throw unauthorized();

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      throw unauthorized('Sesión inválida o expirada');
    }
    if (payload.typ !== 'access') throw unauthorized('Sesión inválida');

    const { rows } = await db.query(
      'SELECT id_usuario, nombre, email, rol, activo, password_hash FROM usuarios WHERE id_usuario = $1',
      [Number(payload.sub)]
    );
    const u = rows[0];
    if (!u || !u.activo || fingerprint(u.password_hash) !== payload.pv) throw unauthorized('Sesión inválida o expirada');
    req.user = { id: u.id_usuario, nombre: u.nombre, email: u.email, rol: u.rol };
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Protección CSRF para sesiones por cookie: las peticiones que modifican datos deben llevar la
 * cabecera personalizada `x-nx-csrf` (un formulario de otro sitio no puede enviarla).
 */
function csrfGuard(req, _res, next) {
  const seguro = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (seguro || (req.headers.authorization || '').startsWith('Bearer ')) return next();
  if (req.headers['x-nx-csrf'] !== '1') return next(forbidden('Falta el encabezado de protección CSRF'));
  next();
}

module.exports = { COOKIE_NAME, signAccessToken, setAuthCookie, clearAuthCookie, authenticate, csrfGuard };
