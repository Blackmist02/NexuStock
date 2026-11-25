const express = require('express');
const { z } = require('zod');
const { esFechaIso } = require('../lib/dates');
const { ApiError, parse } = require('../lib/errors');
const fechaSistema = require('../lib/fechaSistema');
const negocio = require('../lib/negocio');
const { requireRole } = require('../middleware/auth');
const { evaluar } = require('../services/alertas');
const { deshacer, importar, plantilla, revisarDeshacer, validar, TIPOS } = require('../services/importacion');

const router = express.Router();
const admin = requireRole('administrador');

// Un año de ventas en CSV pesa unos 2-3 MB: este router acepta cuerpos más grandes que el resto de la API
router.use(express.json({ limit: '30mb' }));

const archivo = z.string().max(30 * 1024 * 1024, 'El archivo es demasiado grande').optional().nullable();
// El navegador puede recortar el archivo antes de enviarlo (filas ya cargadas al inicio y posteriores al límite al
// final): informa cuántas omitió y cuántas líneas saltó al inicio, para que el resumen y los números de línea cuadren
const n = z.number().int().min(0).max(10_000_000);
const recorte = z.object({ lineas_omitidas: n, ya_cargadas: n, posteriores: n }).optional().nullable();
const schema = z.object({
  ventas: archivo,
  compras: archivo,
  mermas: archivo,
  recorte: z.object({ ventas: recorte, compras: recorte, mermas: recorte }).optional().nullable(),
  hasta: z.string().refine(esFechaIso, 'Fecha límite inválida (AAAA-MM-DD)').optional().nullable(),
  avanzar: z.boolean().optional().default(false)
});

const params = (body) => {
  const b = parse(schema, body);
  return { archivos: { ventas: b.ventas, compras: b.compras, mermas: b.mermas }, recorte: b.recorte || {}, hasta: b.hasta || null, avanzar: b.avanzar };
};

/** Plantilla CSV de ventas, compras o mermas, con dos filas de ejemplo. */
router.get('/plantilla/:tipo', admin, async (req, res) => {
  const tipo = req.params.tipo.replace(/\.csv$/, '');
  if (!TIPOS[tipo]) throw new ApiError(404, 'no_encontrado', 'Plantilla no encontrada');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="plantilla-${tipo}.csv"`);
  res.send(await plantilla(tipo));
});

/** Revisa los archivos y muestra qué se importaría, sin escribir nada. */
router.post('/validar', admin, async (req, res) => {
  res.json({ data: await validar(params(req.body)) });
});

/**
 * Importa ventas, compras y mermas (todo o nada). Si se pidió, mueve la fecha del sistema al día siguiente de la fecha
 * límite. Después recalcula proyecciones y alertas, como haría el registro manual de cada movimiento.
 */
router.post('/', admin, async (req, res) => {
  const p = params(req.body);
  const r = await importar(p, req.user.id);
  if (!r.importado) {
    return res.status(400).json({ error: { code: 'importacion_invalida', message: 'No se importó nada: revisa los errores' }, data: r });
  }
  if (r.fecha_sistema.nueva) {
    try {
      await negocio.guardarFechaReferencia(r.fecha_sistema.nueva, req.user.id);
    } catch (e) {
      console.error('[importación] no se pudo mover la fecha del sistema:', e.message);
      r.fecha_sistema.nueva = null;
    }
  }
  const ev = await evaluar().catch((e) => {
    console.error('[importación] no se pudo recalcular las alertas:', e.message);
    return null;
  });
  res.status(201).json({ data: { ...r, evaluacion: ev && { evaluados: ev.evaluados, creadas: ev.creadas, cerradas: ev.cerradas } } });
});

/**
 * Deshacer movimientos desde una fecha, para volver a mostrar una carga en una demostración. Solo con fecha de
 * referencia (datos históricos): con la fecha real se borrarían ventas y compras verdaderas.
 */
const desdeSchema = z.object({ desde: z.string({ error: 'Elige una fecha' }).refine(esFechaIso, 'Fecha inválida (AAAA-MM-DD)') });
const desdeDe = (body) => {
  if (!fechaSistema.referencia()) {
    throw new ApiError(409, 'solo_fecha_referencia', 'Deshacer movimientos solo está disponible con una fecha de referencia (datos históricos), no con la fecha real');
  }
  return parse(desdeSchema, body).desde;
};

router.post('/deshacer/validar', admin, async (req, res) => {
  res.json({ data: await revisarDeshacer(desdeDe(req.body)) });
});

/** Borra los movimientos, devuelve el stock, deja la fecha del sistema en `desde` y recalcula las alertas. */
router.post('/deshacer', admin, async (req, res) => {
  const r = await deshacer(desdeDe(req.body));
  if (!r.deshecho) {
    return res.status(400).json({ error: { code: 'deshacer_invalido', message: r.errores_generales.join(' ') || 'No se deshizo nada' }, data: r });
  }
  await negocio.guardarFechaReferencia(r.desde, req.user.id);
  console.info(`[importación] usuario ${req.user.id} deshizo ${r.total} movimientos desde el ${r.desde}`);
  const ev = await evaluar().catch((e) => {
    console.error('[importación] no se pudo recalcular las alertas:', e.message);
    return null;
  });
  res.json({ data: { ...r, evaluacion: ev && { evaluados: ev.evaluados, creadas: ev.creadas, cerradas: ev.cerradas } } });
});

module.exports = router;
