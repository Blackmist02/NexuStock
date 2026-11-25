const { Router } = require('express');
const { z } = require('zod');
const db = require('../db');
const { addDays, esFechaIso, hoy, inicioMes } = require('../lib/dates');
const { ApiError, parse } = require('../lib/errors');
const { errorCampo, fechaQuery, idParam } = require('../lib/http');
const { requireRole } = require('../middleware/auth');
const { eventosEnRango } = require('../services/eventos');

const router = Router();
const editar = requireRole('administrador', 'ti');

router.get('/', async (req, res) => {
  const hoyIso = hoy();
  const desde = fechaQuery(req.query.desde, 'desde') || inicioMes(hoyIso);
  const hasta = fechaQuery(req.query.hasta, 'hasta') || addDays(desde, 41);
  if (desde > hasta) throw errorCampo('hasta', 'La fecha final no puede ser anterior a la inicial');
  if (addDays(desde, 400) < hasta) throw errorCampo('hasta', 'El rango máximo es de 400 días');
  res.json({ hoy: hoyIso, data: await eventosEnRango(desde, hasta) });
});

const schema = z.object({
  fecha: z.string({ error: 'Fecha inválida' }).refine(esFechaIso, 'Fecha inválida'),
  nombre: z.string({ error: 'Ingresa el nombre' }).trim().min(2, 'Ingresa el nombre').max(80, 'Máximo 80 caracteres'),
  tipo: z.enum(['fiestas_patrias', 'semana_santa', 'feriado_largo', 'feriado', 'otro'], { error: 'Tipo de evento inválido' })
});

router.post('/', editar, async (req, res) => {
  const b = parse(schema, req.body);
  const { rows } = await db.query(
    `INSERT INTO eventos_calendario (fecha, nombre, tipo) VALUES ($1::date, $2, $3)
     RETURNING id_evento, to_char(fecha, 'YYYY-MM-DD') AS fecha, nombre, tipo`,
    [b.fecha, b.nombre, b.tipo]
  );
  res.status(201).json({ data: { ...rows[0], derivado: false } });
});

router.delete('/:id', editar, async (req, res) => {
  const r = await db.query('DELETE FROM eventos_calendario WHERE id_evento = $1', [idParam(req)]);
  if (!r.rowCount) throw new ApiError(404, 'no_encontrado', 'El evento no existe');
  res.status(204).end();
});

module.exports = router;
