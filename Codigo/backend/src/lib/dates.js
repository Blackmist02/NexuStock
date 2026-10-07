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

module.exports = { hoy, addDays, isoWeekday, diffDays };
