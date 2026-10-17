const { Router } = require('express');
const { z } = require('zod');
const db = require('../db');
const { ApiError, parse } = require('../lib/errors');
const { errorCampo, idParam } = require('../lib/http');
const { hashPassword, passwordSchema } = require('../lib/password');
const { enlaceRestablecer } = require('../lib/reset');
const { requireRole } = require('../middleware/auth');

const router = Router();
router.use(requireRole('administrador', 'ti'));

const ROLES = ['administrador', 'operador', 'ti'];
const emailSchema = z.string({ error: 'Ingresa un correo válido' }).trim().toLowerCase().email('Ingresa un correo válido').max(160);
const rolSchema = z.enum(ROLES, { error: 'Elige un rol válido' });
const COLUMNAS = 'id_usuario AS id, nombre, email, rol, activo, creado_en';

router.get('/', async (_req, res) => {
  const { rows } = await db.query(`SELECT ${COLUMNAS} FROM usuarios ORDER BY activo DESC, creado_en`);
  res.json({ data: rows });
});

/** RF-12: alta de un integrante del equipo con el rol elegido (el alta inicial se hace en «Crear cuenta»). */
router.post('/', async (req, res) => {
  const b = parse(
    z.object({ nombre: z.string({ error: 'Ingresa el nombre' }).trim().min(2, 'Ingresa el nombre').max(120), email: emailSchema, password: passwordSchema, rol: rolSchema }),
    req.body
  );
  try {
    const { rows } = await db.query(`INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNAS}`, [
      b.nombre, b.email, await hashPassword(b.password), b.rol
    ]);
    res.status(201).json({ data: rows[0] });
  } catch (e) {
    if (e.code === '23505') throw errorCampo('email', 'Ese correo ya está registrado');
    throw e;
  }
});

/** Cambia nombre, rol o estado (baja lógica). Nadie puede quitarse su propio acceso ni dejar el sistema sin administrador. */
router.patch('/:id', async (req, res) => {
  const id = idParam(req);
  const b = parse(
    z.object({ nombre: z.string().trim().min(2, 'Ingresa el nombre').max(120).optional(), rol: rolSchema.optional(), activo: z.boolean().optional() }),
    req.body
  );
  const actual = (await db.query('SELECT id_usuario, rol, activo FROM usuarios WHERE id_usuario = $1', [id])).rows[0];
  if (!actual) throw new ApiError(404, 'no_encontrado', 'El usuario no existe');
  const nuevoRol = b.rol ?? actual.rol;
  const nuevoActivo = b.activo ?? actual.activo;
  if (id === req.user.id && (nuevoRol !== actual.rol || nuevoActivo !== actual.activo)) {
    throw new ApiError(409, 'usuario_propio', 'No puedes cambiar tu propio rol ni desactivar tu propia cuenta.');
  }
  if (actual.rol === 'administrador' && actual.activo && (nuevoRol !== 'administrador' || !nuevoActivo)) {
    const otros = (await db.query(`SELECT COUNT(*)::int AS n FROM usuarios WHERE rol = 'administrador' AND activo AND id_usuario <> $1`, [id])).rows[0].n;
    if (otros === 0) throw new ApiError(409, 'ultimo_administrador', 'Debe quedar al menos un administrador activo en el sistema.');
  }
  const { rows } = await db.query(
    `UPDATE usuarios SET nombre = COALESCE($2, nombre), rol = $3, activo = $4 WHERE id_usuario = $1 RETURNING ${COLUMNAS}`,
    [id, b.nombre ?? null, nuevoRol, nuevoActivo]
  );
  res.json({ data: rows[0] });
});

/** RF-13: el administrador TI emite el enlace de restablecimiento cuando la persona no tiene acceso a su correo. */
router.post('/:id/reset-link', requireRole('ti'), async (req, res) => {
  const id = idParam(req);
  const u = (await db.query('SELECT id_usuario, nombre, password_hash, activo FROM usuarios WHERE id_usuario = $1', [id])).rows[0];
  if (!u) throw new ApiError(404, 'no_encontrado', 'El usuario no existe');
  if (!u.activo) throw new ApiError(409, 'usuario_inactivo', 'La cuenta está inactiva.');
  res.json({ data: { enlace: enlaceRestablecer(u), vence_en_minutos: 30 } });
});

module.exports = router;
