const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { forbidden, unauthorized } = require('../lib/errors');
const { fingerprint } = require('../lib/password');

const COOKIE_NAME = 'nx_token';
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' };

/** Duración de la sesión con «Recordarme» (RF-07): 30 días; sin marcarla, hasta cerrar el navegador o JWT_EXPIRES_IN. */
const RECORDAR_MS = 30 * 24 * 60 * 60 * 1000;

/** Token de acceso. `pv` es la huella de la contraseña vigente: si la contraseña cambia, el token deja de servir. */
function signAccessToken(user, recordar = false) {
  return jwt.sign({ sub: String(user.id_usuario), pv: fingerprint(user.password_hash), typ: 'access' }, config.jwtSecret, {
    expiresIn: recordar ? '30d' : config.jwtExpiresIn,
    algorithm: 'HS256'
  });
}

/** Con «Recordarme» la cookie dura 30 días; sin ella es de sesión (se borra al cerrar el navegador). */
const setAuthCookie = (res, token, recordar = false) =>
  res.cookie(COOKIE_NAME, token, recordar ? { ...cookieOpts, maxAge: RECORDAR_MS } : cookieOpts);
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

/** Autoriza solo a los roles indicados (RF-07). Se usa después de `authenticate`. */
const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.rol)) return next(forbidden('Tu rol no tiene permiso para esta acción'));
  next();
};

module.exports = { requireRole, COOKIE_NAME, signAccessToken, setAuthCookie, clearAuthCookie, authenticate, csrfGuard };
