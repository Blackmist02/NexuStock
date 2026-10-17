/**
 * Calendario de eventos (EVENTOS_CALENDARIO): feriados de Chile, Semana Santa y Fiestas Patrias que alimentan al
 * modelo como variables de demanda. La tabla no tiene llaves foráneas; se cruza por fecha.
 * Quincena (día 15) y fin de mes se calculan al vuelo y no se guardan.
 */
const db = require('../db');
const { addDays, finMes, isoWeekday } = require('../lib/dates');

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher). */
function pascua(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, mes, dia);
}

/** Traslado de feriados movibles (Ley 19.668): martes/miércoles → lunes anterior; jueves/viernes → lunes siguiente. */
function aLunes(f) {
  const wd = isoWeekday(f);
  if (wd === 2 || wd === 3) return addDays(f, -(wd - 1));
  if (wd === 4 || wd === 5) return addDays(f, 8 - wd);
  return f;
}

/** Día de las Iglesias Evangélicas: martes → viernes anterior; miércoles → viernes siguiente. */
function evangelicas(f) {
  const wd = isoWeekday(f);
  if (wd === 2) return addDays(f, -4);
  if (wd === 3) return addDays(f, 2);
  return f;
}

const PUEBLOS_INDIGENAS = { 2022: 21, 2023: 21, 2024: 20, 2025: 20, 2026: 21, 2027: 21 };

/** Feriados de un año: [{ fecha, nombre, tipo }]. Referenciales: el administrador puede ajustarlos. */
function feriadosChile(y) {
  const p = pascua(y);
  const lista = [
    [iso(y, 1, 1), 'Año Nuevo'],
    [addDays(p, -2), 'Viernes Santo', 'semana_santa'],
    [addDays(p, -1), 'Sábado Santo', 'semana_santa'],
    [iso(y, 5, 1), 'Día del Trabajo'],
    [iso(y, 5, 21), 'Día de las Glorias Navales'],
    [iso(y, 6, PUEBLOS_INDIGENAS[y] || 21), 'Día de los Pueblos Indígenas'],
    [aLunes(iso(y, 6, 29)), 'San Pedro y San Pablo'],
    [iso(y, 7, 16), 'Día de la Virgen del Carmen'],
    [iso(y, 8, 15), 'Asunción de la Virgen'],
    [iso(y, 9, 18), 'Fiestas Patrias', 'fiestas_patrias'],
    [iso(y, 9, 19), 'Día de las Glorias del Ejército', 'fiestas_patrias'],
    [aLunes(iso(y, 10, 12)), 'Encuentro de Dos Mundos'],
    [evangelicas(iso(y, 10, 31)), 'Día de las Iglesias Evangélicas'],
    [iso(y, 11, 1), 'Todos los Santos'],
    [iso(y, 12, 8), 'Inmaculada Concepción'],
    [iso(y, 12, 25), 'Navidad']
  ];
  if (isoWeekday(iso(y, 9, 18)) === 2) lista.push([iso(y, 9, 17), 'Feriado adicional Fiestas Patrias', 'fiestas_patrias']);
  if (isoWeekday(iso(y, 9, 19)) === 3) lista.push([iso(y, 9, 20), 'Feriado adicional Fiestas Patrias', 'fiestas_patrias']);
  return lista.map(([fecha, nombre, tipo]) => {
    const wd = isoWeekday(fecha);
    // Un feriado en lunes o viernes forma un fin de semana largo
    return { fecha, nombre, tipo: tipo || (wd === 1 || wd === 5 ? 'feriado_largo' : 'feriado') };
  });
}

/** Carga los feriados 2022 → año siguiente si la tabla está vacía (el cálculo del modelo usa 2022–2024). */
async function sembrarSiVacio() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM eventos_calendario');
  if (rows[0].n > 0) return 0;
  const hasta = new Date().getFullYear() + 1;
  const todos = [];
  for (let y = 2022; y <= Math.max(2027, hasta); y++) todos.push(...feriadosChile(y));
  await db.query(
    `INSERT INTO eventos_calendario (fecha, nombre, tipo)
     SELECT * FROM unnest($1::date[], $2::text[], $3::text[])`,
    [todos.map((e) => e.fecha), todos.map((e) => e.nombre), todos.map((e) => e.tipo)]
  );
  return todos.length;
}

/** Eventos de la tabla más los derivados (quincena y fin de mes) dentro de [desde, hasta]. */
async function eventosEnRango(desde, hasta) {
  const { rows } = await db.query(
    `SELECT id_evento, to_char(fecha, 'YYYY-MM-DD') AS fecha, nombre, tipo
       FROM eventos_calendario WHERE fecha BETWEEN $1::date AND $2::date ORDER BY fecha, nombre`,
    [desde, hasta]
  );
  const out = rows.map((r) => ({ ...r, derivado: false }));
  for (let f = desde; f <= hasta; f = addDays(f, 1)) {
    if (f.slice(8) === '15') out.push({ id_evento: null, fecha: f, nombre: 'Quincena', tipo: 'quincena', derivado: true });
    if (f === finMes(f)) out.push({ id_evento: null, fecha: f, nombre: 'Fin de mes', tipo: 'fin_de_mes', derivado: true });
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

module.exports = { feriadosChile, pascua, sembrarSiVacio, eventosEnRango };
