const { Router } = require('express');
const { z } = require('zod');
const { enviarCsv } = require('../lib/csv');
const { hoy } = require('../lib/dates');
const { idParam } = require('../lib/http');
const { parse } = require('../lib/errors');
const { requireRole } = require('../middleware/auth');
const { calcularRiesgos, evaluar, listar, resolver } = require('../services/alertas');
const { snapshotInventario } = require('../services/inventario');

const router = Router();

/** Semáforo y sugerencias de compra calculados al vuelo (servicio que consume el dashboard, Diagrama de secuencia 1). */
router.get('/recommendations', async (req, res) => {
  const inventario = await snapshotInventario();
  const hoyIso = hoy();
  const semaforo = { quiebre: 0, bajo: 0, optimo: 0, total: inventario.length };
  for (const p of inventario) semaforo[p.nivel]++;
  const sugerencias = calcularRiesgos(inventario, hoyIso);
  if (req.query.format === 'csv') {
    const NIVEL = { quiebre: 'Quiebre', bajo: 'Bajo', optimo: 'Óptimo' };
    return enviarCsv(res, `sugerencias-de-compra-${hoyIso}.csv`, [
      { titulo: 'Producto', valor: (s) => s.producto },
      { titulo: 'Nivel', valor: (s) => NIVEL[s.nivel] },
      { titulo: 'Stock actual', valor: (s) => s.stock_actual },
      { titulo: 'Unidad', valor: (s) => s.unidad },
      { titulo: 'Cantidad sugerida', valor: (s) => s.cantidad_sugerida },
      { titulo: 'Proveedor', valor: (s) => s.proveedor },
      { titulo: 'Fecha límite para pedir', valor: (s) => s.fecha_limite_pedido }
    ], sugerencias);
  }
  res.json({ hoy: hoyIso, semaforo, sugerencias });
});

/** Alertas guardadas (por defecto las activas), ordenadas por nivel de riesgo y fecha límite de pedido (RF-05). */
router.get('/', async (req, res) => {
  const estado = ['activa', 'atendida', 'descartada', 'todas'].includes(req.query.estado) ? req.query.estado : 'activa';
  res.json({ data: await listar({ estado }) });
});

/** Recalcula las proyecciones y las alertas de todos los productos activos (RF-08, RF-09, RF-10). */
router.post('/evaluate', requireRole('administrador', 'ti'), async (_req, res) => {
  const r = await evaluar();
  res.json({ data: { evaluados: r.evaluados, creadas: r.creadas, actualizadas: r.actualizadas, cerradas: r.cerradas } });
});

/** RF-05: «Atender» (pedido gestionado) o «Descartar» una alerta activa. */
router.patch('/:id', requireRole('administrador'), async (req, res) => {
  const id = idParam(req);
  const { estado } = parse(z.object({ estado: z.enum(['atendida', 'descartada'], { error: 'Elige «atendida» o «descartada»' }) }), req.body);
  res.json({ data: await resolver(id, estado) });
});

module.exports = router;
