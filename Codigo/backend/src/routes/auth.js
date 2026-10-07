const { Router } = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const config = require('../config');
const db = require('../db');
const { ApiError, forbidden, parse, unauthorized } = require('../lib/errors');
const { enviarCorreo } = require('../lib/mailer');
const { DUMMY_HASH, fingerprint, hashPassword, passwordSchema, verifyPassword } = require('../lib/password');
const { authenticate, clearAuthCookie, setAuthCookie, signAccessToken } = require('../middleware/auth');

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.authRateLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'demasiados_intentos', message: 'Demasiados intentos. Intenta nuevamente en unos minutos.' } }
});

const emailSchema = z.string().trim().toLowerCase().email('Correo inválido').max(160);

const publicUser = (u) => ({ id: u.id_usuario, nombre: u.nombre, email: u.email, rol: u.rol });

/** ¿Se puede crear una cuenta? La primera siempre; las siguientes solo con ALLOW_PUBLIC_SIGNUP=true. */
router.get('/setup-status', async (_req, res) => {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM usuarios');
  const necesitaRegistro = rows[0].n === 0;
  res.json({ necesitaRegistro, registroAbierto: necesitaRegistro || config.allowPublicSignup });
});

/**
 * Crear cuenta. La primera cuenta del sistema queda como administrador; las siguientes (si el registro
 * público está habilitado) como operador, el rol con menos privilegios. Los permisos finos se definen en el
 * diseño por rol (administrador / operador / ti).
 */
router.post('/register', limiter, async (req, res) => {
  const body = parse(
    z.object({ nombre: z.string().trim().min(2, 'Ingresa tu nombre').max(120), email: emailSchema, password: passwordSchema }),
    req.body
  );
  const hash = await hashPassword(body.password);
  const client = await db.pool.connect();
  let user;
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE usuarios IN SHARE ROW EXCLUSIVE MODE'); // evita dos «primeras cuentas» simultáneas
    const n = (await client.query('SELECT COUNT(*)::int AS n FROM usuarios')).rows[0].n;
    if (n > 0 && !config.allowPublicSignup) {
      throw forbidden('El registro está cerrado. Pide a un administrador que cree tu usuario.');
    }
    const r = await client.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, $4)
       RETURNING id_usuario, nombre, email, rol, password_hash`,
      [body.nombre, body.email, hash, n === 0 ? 'administrador' : 'operador']
    );
    await client.query('COMMIT');
    user = r.rows[0];
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  const token = signAccessToken(user);
  setAuthCookie(res, token);
  res.status(201).json({ user: publicUser(user), token });
});

router.post('/login', limiter, async (req, res) => {
  const body = parse(z.object({ email: emailSchema, password: z.string().min(1).max(128) }), req.body);
  const { rows } = await db.query(
    'SELECT id_usuario, nombre, email, rol, activo, password_hash FROM usuarios WHERE email = $1',
    [body.email]
  );
  const u = rows[0];
  const ok = await verifyPassword(body.password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok || !u.activo) throw unauthorized('Correo o contraseña incorrectos');
  const token = signAccessToken(u);
  setAuthCookie(res, token);
  res.json({ user: publicUser(u), token });
});

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.status(204).end();
});

/** Estado de sesión para el frontend: siempre 200 (`user: null` si no hay sesión), sin ruido de 401 en consola. */
router.get('/session', (req, res, next) => {
  authenticate(req, res, (err) => {
    if (err && !(err instanceof ApiError && err.status === 401)) return next(err);
    res.json({ user: req.user || null });
  });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

/** Solicita el enlace de recuperación. Siempre responde 202 para no revelar qué correos existen. */
router.post('/forgot', limiter, async (req, res) => {
  const { email } = parse(z.object({ email: emailSchema }), req.body);
  const { rows } = await db.query('SELECT id_usuario, nombre, password_hash, activo FROM usuarios WHERE email = $1', [email]);
  const u = rows[0];
  if (u && u.activo) {
    const token = jwt.sign({ sub: String(u.id_usuario), typ: 'reset', fp: fingerprint(u.password_hash) }, config.jwtSecret, {
      expiresIn: '30m',
      algorithm: 'HS256'
    });
    const link = `${config.appUrl}/recuperar-contrasena?token=${encodeURIComponent(token)}`;
    try {
      await enviarCorreo(
        email,
        'Recupera tu contraseña de NexuStock',
        `Hola ${u.nombre},\n\nUsa este enlace para crear una nueva contraseña. Vence en 30 minutos y solo se puede usar una vez:\n\n${link}\n\nSi no lo solicitaste, ignora este mensaje.`
      );
    } catch (e) {
      console.error('[auth] no se pudo enviar el correo de recuperación:', e.message);
    }
  }
  res.status(202).json({ ok: true });
});

router.post('/reset', limiter, async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10), password: passwordSchema }), req.body);
  let payload;
  try {
    payload = jwt.verify(body.token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new ApiError(400, 'enlace_invalido', 'El enlace venció o no es válido. Solicita uno nuevo.');
  }
  if (payload.typ !== 'reset') throw new ApiError(400, 'enlace_invalido', 'El enlace no es válido.');
  const { rows } = await db.query('SELECT id_usuario, password_hash, activo FROM usuarios WHERE id_usuario = $1', [Number(payload.sub)]);
  const u = rows[0];
  // La huella de la contraseña vigente hace que el enlace sirva una sola vez
  if (!u || !u.activo || fingerprint(u.password_hash) !== payload.fp) {
    throw new ApiError(400, 'enlace_invalido', 'El enlace ya fue usado o venció. Solicita uno nuevo.');
  }
  await db.query('UPDATE usuarios SET password_hash = $1 WHERE id_usuario = $2', [await hashPassword(body.password), u.id_usuario]);
  clearAuthCookie(res); // las sesiones anteriores quedan invalidadas al cambiar la huella
  res.json({ ok: true });
});

module.exports = router;
