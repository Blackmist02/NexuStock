const config = require('../config');

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.tz,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** Fecha de hoy (AAAA-MM-DD) en la zona horaria del negocio, o FECHA_REFERENCIA si está definida (demo). */
const hoy = (now) => (now === undefined && config.fechaReferencia ? config.fechaReferencia : fmt.format(now ?? new Date()));

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Día ISO de la semana: 1 = lunes … 7 = domingo. */
function isoWeekday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return wd === 0 ? 7 : wd;
}

function diffDays(a, b) {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pa[0], pa[1] - 1, pa[2]) - Date.UTC(pb[0], pb[1] - 1, pb[2])) / 86400000);
}

/** Lunes de la semana que se planifica: el siguiente si hoy es domingo; si no, el de la semana en curso. */
function semanaObjetivo(hoyIso) {
  const manana = addDays(hoyIso, 1);
  return addDays(manana, -(isoWeekday(manana) - 1));
}

/**
 * Expresión SQL del instante actual del negocio: now(), o en la demostración la FECHA_REFERENCIA con la hora
 * actual de la carnicería. Parámetros: fecha de referencia (o null) y zona horaria.
 */
const momentoSql = (pRef, pTz) =>
  `CASE WHEN ${pRef}::date IS NULL THEN now() ` +
  `ELSE ((${pRef}::date + (now() AT TIME ZONE ${pTz})::time) AT TIME ZONE ${pTz}) END`;

module.exports = { hoy, addDays, isoWeekday, diffDays, semanaObjetivo, momentoSql };
