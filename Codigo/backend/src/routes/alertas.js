const { Router } = require('express');
const { z } = require('zod');
const { ApiError, parse } = require('../lib/errors');
const { listarAlertas, resolverAlerta } = require('../services/alertas');

const router = Router();

/** Historial de alertas (CU-05): GET /api/alertas?estado=activa|atendida|descartada&nivel=quiebre|bajo */
router.get('/', async (req, res) => {
  const q = parse(
    z.object({
      estado: z.enum(['activa', 'atendida', 'descartada']).optional(),
      nivel: z.enum(['quiebre', 'bajo']).optional(),
      limite: z.coerce.number().int().min(1).max(1000).optional()
    }),
    req.query
  );
  res.json(await listarAlertas(q));
});

/** Atender o descartar una alerta activa: PATCH /api/alertas/:id { estado } */
router.patch('/:id', async (req, res) => {
  const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
  const { estado } = parse(z.object({ estado: z.enum(['atendida', 'descartada']) }), req.body);
  const alerta = await resolverAlerta(id, estado);
  if (!alerta) throw new ApiError(409, 'alerta_cerrada', 'La alerta no existe o ya fue atendida o descartada.');
  res.json(alerta);
});

module.exports = router;
