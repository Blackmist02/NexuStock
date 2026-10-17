const { Router } = require('express');
const { z } = require('zod');
const { parse } = require('../lib/errors');
const negocio = require('../lib/negocio');
const { requireRole } = require('../middleware/auth');

const router = Router();

const respuesta = () => {
  const c = negocio.leer();
  return { negocio: { nombre: c.nombre }, alertas: c.alertas };
};

router.get('/', (_req, res) => {
  res.json({ data: respuesta() });
});

/** Datos del negocio y activación de las alertas de nivel Quiebre y Bajo. */
router.put('/', requireRole('administrador', 'ti'), (req, res) => {
  const b = parse(
    z.object({
      nombre: z.string({ error: 'Ingresa el nombre de la carnicería' }).trim().min(2, 'Ingresa el nombre de la carnicería').max(80, 'Máximo 80 caracteres').optional(),
      alertas: z.object({ quiebre: z.boolean().optional(), bajo: z.boolean().optional() }).optional()
    }),
    req.body
  );
  negocio.guardar(b);
  res.json({ data: respuesta() });
});

module.exports = router;
