// Autenticación (tarea 27): hash de contraseñas, expiración y validez del token, roles y límite de intentos.
// Sin base de datos: la consulta del usuario se reemplaza por un doble de prueba. Ejecutar con: npm test
process.env.AUTH_RATE_LIMIT = '3'; // antes de cargar la configuración: límite bajo para probarlo rápido
process.env.JWT_EXPIRES_IN = '8h';

const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/db');
const { hashPassword, verifyPassword, fingerprint } = require('../src/lib/password');
const { signAccessToken, authenticate, requireRole, csrfGuard } = require('../src/middleware/auth');

const queryOriginal = db.query;
let usuario;
before(async () => {
  usuario = { id_usuario: 7, nombre: 'Ana', email: 'ana@carniceria.cl', rol: 'operador', activo: true, password_hash: await hashPassword('Clave1234') };
  db.query = async () => ({ rows: usuario ? [usuario] : [] });
});
after(() => {
  db.query = queryOriginal;
});

/** Ejecuta un middleware de Express y devuelve el error que pasó a next() (o null). */
const correr = (mw, req) => new Promise((resolve) => mw(req, {}, (err) => resolve(err || null)));
const conToken = (token) => ({ headers: { authorization: `Bearer ${token}` }, cookies: {} });

test('hash de contraseña: bcrypt con costo 12, sal distinta en cada hash y verificación', async () => {
  const a = await hashPassword('Clave1234');
  const b = await hashPassword('Clave1234');
  assert.match(a, /^\$2[aby]\$12\$/);
  assert.notEqual(a, b); // la sal cambia: dos cuentas con la misma clave no comparten hash
  assert.equal(await verifyPassword('Clave1234', a), true);
  assert.equal(await verifyPassword('clave1234', a), false);
  assert.ok(!a.includes('Clave1234'));
});

test('token de acceso: dura 8 h o 30 días con «Recordarme» y lleva la huella de la contraseña', () => {
  const t = jwt.decode(signAccessToken(usuario));
  assert.equal(t.exp - t.iat, 8 * 3600);
  assert.equal(t.sub, '7');
  assert.equal(t.typ, 'access');
  assert.equal(t.pv, fingerprint(usuario.password_hash));
  const r = jwt.decode(signAccessToken(usuario, true));
  assert.equal(r.exp - r.iat, 30 * 24 * 3600);
});

test('token válido: carga el usuario vigente en la petición', async () => {
  const req = conToken(signAccessToken(usuario));
  assert.equal(await correr(authenticate, req), null);
  assert.deepEqual(req.user, { id: 7, nombre: 'Ana', email: 'ana@carniceria.cl', rol: 'operador' });
});

test('token expirado, adulterado, de otro tipo o ausente: 401', async () => {
  const pv = fingerprint(usuario.password_hash);
  const expirado = jwt.sign({ sub: '7', pv, typ: 'access', exp: Math.floor(Date.now() / 1000) - 60 }, config.jwtSecret);
  const otraClave = jwt.sign({ sub: '7', pv, typ: 'access' }, 'otro-secreto-de-al-menos-32-caracteres!!');
  const deRecuperacion = jwt.sign({ sub: '7', typ: 'reset', fp: pv }, config.jwtSecret, { expiresIn: '30m' });
  const sinFirma = jwt.sign({ sub: '7', pv, typ: 'access' }, null, { algorithm: 'none' });
  for (const token of [expirado, otraClave, deRecuperacion, sinFirma]) {
    const err = await correr(authenticate, conToken(token));
    assert.equal(err && err.status, 401, `debió rechazarse: ${jwt.decode(token)?.typ}`);
  }
  assert.equal((await correr(authenticate, { headers: {}, cookies: {} })).status, 401);
});

test('cambiar la contraseña o desactivar la cuenta invalida las sesiones abiertas', async () => {
  const token = signAccessToken(usuario);
  const hashAnterior = usuario.password_hash;
  usuario.password_hash = await hashPassword('NuevaClave99');
  assert.equal((await correr(authenticate, conToken(token))).status, 401);
  usuario.password_hash = hashAnterior;
  usuario.activo = false;
  assert.equal((await correr(authenticate, conToken(token))).status, 401);
  usuario.activo = true;
});

test('roles: solo pasan los roles autorizados (403); sin sesión, 401', async () => {
  const soloAdmin = requireRole('administrador');
  const adminOTi = requireRole('administrador', 'ti');
  assert.equal((await correr(soloAdmin, { user: { rol: 'operador' } })).status, 403);
  assert.equal(await correr(soloAdmin, { user: { rol: 'administrador' } }), null);
  assert.equal(await correr(adminOTi, { user: { rol: 'ti' } }), null);
  assert.equal((await correr(adminOTi, { user: { rol: 'operador' } })).status, 403);
  assert.equal((await correr(soloAdmin, {})).status, 401);
});

test('CSRF: con cookie, las escrituras exigen la cabecera x-nx-csrf', async () => {
  assert.equal(await correr(csrfGuard, { method: 'GET', headers: {} }), null);
  assert.equal((await correr(csrfGuard, { method: 'POST', headers: {} })).status, 403);
  assert.equal(await correr(csrfGuard, { method: 'POST', headers: { 'x-nx-csrf': '1' } }), null);
  assert.equal(await correr(csrfGuard, { method: 'POST', headers: { authorization: 'Bearer x' } }), null);
});

test('límite de intentos: después de AUTH_RATE_LIMIT intentos en 15 min responde 429', async () => {
  const { errorHandler } = require('../src/middleware/errors');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../src/routes/auth'));
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/auth/login`;
    const intento = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const estados = [];
    for (let i = 0; i < 5; i++) estados.push((await intento()).status);
    assert.deepEqual(estados, [400, 400, 400, 429, 429]); // 3 intentos (datos inválidos) y luego bloqueo
    const r = await intento();
    assert.equal((await r.json()).error.code, 'demasiados_intentos');
    assert.ok(Number(r.headers.get('retry-after')) > 0);
  } finally {
    server.close();
  }
});
