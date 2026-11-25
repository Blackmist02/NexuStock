const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { z } = require('zod');

const passwordSchema = z
  .string()
  .min(8, 'Al menos 8 caracteres')
  .max(128, 'Máximo 128 caracteres')
  .regex(/[A-Z]/, 'Debe incluir una letra mayúscula')
  .regex(/[0-9]/, 'Debe incluir un número');

const hashPassword = (pw) => bcrypt.hash(pw, 12);
const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);
// Hash válido para comparar cuando el correo no existe (evita revelar usuarios por tiempo de respuesta)
const DUMMY_HASH = bcrypt.hashSync('nexustock-dummy-password', 12);
// Huella corta del hash vigente: invalida sesiones y enlaces de recuperación cuando la contraseña cambia
const fingerprint = (hash) => crypto.createHash('sha256').update(hash).digest('hex').slice(0, 16);

module.exports = { passwordSchema, hashPassword, verifyPassword, DUMMY_HASH, fingerprint };
