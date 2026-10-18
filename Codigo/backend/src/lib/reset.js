const jwt = require('jsonwebtoken');
const config = require('../config');
const { fingerprint } = require('./password');

/** Enlace de restablecimiento: token firmado, vence en 30 min y deja de servir al cambiar la contraseña (RF-13). */
function enlaceRestablecer(usuario) {
  const token = jwt.sign({ sub: String(usuario.id_usuario), typ: 'reset', fp: fingerprint(usuario.password_hash) }, config.jwtSecret, {
    expiresIn: '30m',
    algorithm: 'HS256'
  });
  return `${config.appUrl}/recuperar-contrasena?token=${encodeURIComponent(token)}`;
}

module.exports = { enlaceRestablecer };
