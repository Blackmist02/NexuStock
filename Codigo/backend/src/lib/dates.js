const config = require('../config');

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.tz,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** Fecha de hoy (AAAA-MM-DD) en la zona horaria del negocio. */
const hoy = (now = new Date()) => fmt.format(now);

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

/** Lunes de la semana de una fecha ISO. */
const inicioSemana = (iso) => addDays(iso, -(isoWeekday(iso) - 1));
/** Primer día del mes de una fecha ISO. */
const inicioMes = (iso) => `${iso.slice(0, 7)}-01`;
/** Último día del mes de una fecha ISO. */
const finMes = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
/** AAAA-MM-DD válida de calendario (rechaza 2026-02-30, que Date.parse acomodaría al 2 de marzo). */
const esFechaIso = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const fmtLocal = new Intl.DateTimeFormat('es-CL', {
  timeZone: config.tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
});
/** Instante → «16/10/2026 14:48» en la zona horaria del negocio. */
function fechaHoraLocal(d) {
  if (!d) return '';
  const p = Object.fromEntries(fmtLocal.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

module.exports = { fechaHoraLocal, hoy, addDays, isoWeekday, diffDays, inicioSemana, inicioMes, finMes, esFechaIso };
