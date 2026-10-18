const { Router } = require('express');
const { z } = require('zod');
const config = require('../config');
const db = require('../db');
const { esFechaIso, hoy } = require('../lib/dates');
const { ApiError, parse } = require('../lib/errors');
const fechaSistema = require('../lib/fechaSistema');
const negocio = require('../lib/negocio');
const { requireRole } = require('../middleware/auth');
const { evaluar } = require('../services/alertas');

const router = Router();
const fechaReal = () => hoy(new Date());

/** Fecha (local del negocio) del último movimiento registrado de cada tipo. */
async function ultimosMovimientos() {
  const { rows } = await db.query(
    `SELECT (SELECT to_char(MAX(fecha_hora AT TIME ZONE $1)::date, 'YYYY-MM-DD') FROM ventas)  AS venta,
            (SELECT to_char(MAX(fecha_hora AT TIME ZONE $1)::date, 'YYYY-MM-DD') FROM compras) AS compra,
            (SELECT to_char(MAX(fecha_hora AT TIME ZONE $1)::date, 'YYYY-MM-DD') FROM mermas)  AS merma`,
    [config.tz]
  ).catch(async (e) => {
    if (e.code !== '42P01') throw e; // base sin MERMAS (modelo v4)
    return db.query(
      `SELECT (SELECT to_char(MAX(fecha_hora AT TIME ZONE $1)::date, 'YYYY-MM-DD') FROM ventas)  AS venta,
              (SELECT to_char(MAX(fecha_hora AT TIME ZONE $1)::date, 'YYYY-MM-DD') FROM compras) AS compra,
              NULL AS merma`,
      [config.tz]
    );
  });
  return rows[0];
}

const ultimoDe = (u) => [u.venta, u.compra, u.merma].filter(Boolean).sort().at(-1) || null;

async function respuesta() {
  const c = negocio.leer();
  const ultimos = await ultimosMovimientos();
  return {
    negocio: { nombre: c.nombre },
    alertas: c.alertas,
    fecha: {
      hoy: hoy(),
      referencia: fechaSistema.referencia() || null,
      origen: fechaSistema.origenReferencia(),
      real: fechaReal(),
      ultimos_movimientos: ultimos,
      minima: ultimoDe(ultimos)
    }
  };
}

router.get('/', async (_req, res) => {
  res.json({ data: await respuesta() });
});

/** Datos del negocio y activación de las alertas de nivel Quiebre y Bajo. */
router.put('/', requireRole('administrador', 'ti'), async (req, res) => {
  const b = parse(
    z.object({
      nombre: z.string({ error: 'Ingresa el nombre de la carnicería' }).trim().min(2, 'Ingresa el nombre de la carnicería').max(80, 'Máximo 80 caracteres').optional(),
      alertas: z.object({ quiebre: z.boolean().optional(), bajo: z.boolean().optional() }).optional()
    }),
    req.body
  );
  await negocio.guardar(b, req.user.id);
  res.json({ data: await respuesta() });
});

/**
 * Fecha de referencia del sistema («hoy» al mostrar datos históricos), guardada en CONFIGURACION: cambia sin reiniciar
 * ni redesplegar. null = usar la fecha real. No puede ser futura ni anterior al último movimiento cargado (los datos
 * posteriores a «hoy» quedarían en el futuro). Al cambiarla se recalculan proyecciones y alertas.
 */
router.put('/fecha', requireRole('administrador', 'ti'), async (req, res) => {
  const { fecha } = parse(
    z.object({ fecha: z.string({ error: 'Fecha inválida' }).refine(esFechaIso, 'Fecha inválida (AAAA-MM-DD)').nullable() }),
    req.body
  );
  if (fecha) {
    if (fecha > fechaReal()) throw new ApiError(400, 'validacion', 'La fecha de referencia no puede ser futura', [{ campo: 'fecha', mensaje: 'No puede ser posterior a hoy' }]);
    const minima = ultimoDe(await ultimosMovimientos());
    if (minima && fecha < minima) {
      throw new ApiError(400, 'validacion', `Hay movimientos cargados hasta el ${minima}: la fecha de referencia debe ser ese día o posterior`, [
        { campo: 'fecha', mensaje: `Debe ser el ${minima} o posterior` }
      ]);
    }
  }
  try {
    await negocio.guardarFechaReferencia(fecha, req.user.id);
  } catch (e) {
    if (e.code === '42P01') throw new ApiError(409, 'sin_migracion', 'La base aún no tiene la tabla CONFIGURACION: aplica migracion_v5.sql');
    throw e;
  }
  const r = await evaluar().catch((e) => {
    console.error('[configuración] no se pudo recalcular tras cambiar la fecha:', e.message);
    return null;
  });
  res.json({ data: { ...(await respuesta()), evaluacion: r && { evaluados: r.evaluados, creadas: r.creadas, cerradas: r.cerradas } } });
});

module.exports = router;
module.exports.ultimosMovimientos = ultimosMovimientos;
module.exports.fechaReal = fechaReal;
