const { Router } = require('express');
const { z } = require('zod');
const db = require('../db');
const { ApiError, parse } = require('../lib/errors');
const { errorCampo, idParam, validarNombreUnico } = require('../lib/http');
const { requireRole } = require('../middleware/auth');

const router = Router();
const catalogo = requireRole('administrador', 'ti');
const schema = z.object({ nombre: z.string({ error: 'Ingresa el nombre' }).trim().min(2, 'Ingresa el nombre').max(40, 'Máximo 40 caracteres') });

const duplicado = (e) => (e.code === '23505' ? errorCampo('nombre', 'Ya existe una categoría con ese nombre') : e);

router.get('/', async (_req, res) => {
  const { rows } = await db.query(
    `SELECT c.id_categoria, c.nombre, COUNT(p.id_producto) FILTER (WHERE p.activo)::int AS productos
       FROM categorias c LEFT JOIN productos p ON p.id_categoria = c.id_categoria
      GROUP BY c.id_categoria ORDER BY c.nombre`
  );
  res.json({ data: rows });
});

router.post('/', catalogo, async (req, res) => {
  const { nombre } = parse(schema, req.body);
  await validarNombreUnico(db, 'categorias', nombre);
  try {
    const { rows } = await db.query('INSERT INTO categorias (nombre) VALUES ($1) RETURNING id_categoria, nombre', [nombre]);
    res.status(201).json({ data: { ...rows[0], productos: 0 } });
  } catch (e) {
    throw duplicado(e);
  }
});

router.put('/:id', catalogo, async (req, res) => {
  const id = idParam(req);
  const { nombre } = parse(schema, req.body);
  await validarNombreUnico(db, 'categorias', nombre, id);
  try {
    const { rows } = await db.query('UPDATE categorias SET nombre = $2 WHERE id_categoria = $1 RETURNING id_categoria, nombre', [id, nombre]);
    if (!rows.length) throw new ApiError(404, 'no_encontrada', 'La categoría no existe');
    res.json({ data: rows[0] });
  } catch (e) {
    throw duplicado(e);
  }
});

router.delete('/:id', catalogo, async (req, res) => {
  const id = idParam(req);
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM productos WHERE id_categoria = $1', [id]);
  if (rows[0].n > 0) {
    throw new ApiError(409, 'tiene_productos', 'La categoría tiene productos asignados. Reasígnalos a otra categoría antes de eliminarla.');
  }
  const r = await db.query('DELETE FROM categorias WHERE id_categoria = $1', [id]);
  if (!r.rowCount) throw new ApiError(404, 'no_encontrada', 'La categoría no existe');
  res.status(204).end();
});

module.exports = router;
