/**
 * Lectura de CSV subidos por el administrador: separador «;» (Excel en español) o «,», comillas dobles, BOM UTF-8 y
 * saltos de línea de Windows. Los encabezados se normalizan (minúsculas, sin tildes, espacios → «_»).
 */

const normalizarEncabezado = (h) =>
  h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Divide el texto en filas de celdas respetando comillas (una celda entre comillas puede tener el separador). */
function dividir(texto, sep) {
  const filas = [];
  let fila = [];
  let celda = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { celda += '"'; i++; } else comillas = false;
      } else celda += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(celda); celda = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = '';
    } else celda += ch;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}

/**
 * Lee un CSV. Devuelve { separador, columnas: [nombre normalizado], filas: [{ linea, valores: { columna: texto } }] }.
 * Omite las filas vacías; `linea` es el número de línea del archivo (el encabezado es la 1).
 */
function leerCsv(texto) {
  const limpio = String(texto || '').replace(/^﻿/, '');
  const primera = limpio.split(/\r?\n/, 1)[0] || '';
  const separador = (primera.match(/;/g) || []).length >= (primera.match(/,/g) || []).length ? ';' : ',';
  const filas = dividir(limpio, separador);
  if (!filas.length) return { separador, columnas: [], filas: [] };
  const columnas = filas[0].map(normalizarEncabezado);
  const salida = [];
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    if (f.every((c) => c.trim() === '')) continue;
    salida.push({ linea: i + 1, valores: Object.fromEntries(columnas.map((c, k) => [c, (f[k] ?? '').trim()])) });
  }
  return { separador, columnas, filas: salida };
}

/** Número con coma o punto decimal ("3,4", "1.250,5", "1250.5"). null si no es válido. */
function leerNumero(txt) {
  let s = String(txt ?? '').trim().replace(/\s/g, '').replace(/\$/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Fecha AAAA-MM-DD, DD/MM/AAAA o DD-MM-AAAA → AAAA-MM-DD válida, o null. */
function leerFecha(txt) {
  const s = String(txt ?? '').trim();
  let y, m, d;
  let r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (r) [, y, m, d] = r;
  else if ((r = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) [, d, m, y] = r;
  else return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const f = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(f.getTime()) && f.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Hora HH:MM o HH:MM:SS → HH:MM:SS, o null. */
function leerHora(txt) {
  const r = String(txt ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!r || Number(r[1]) > 23 || Number(r[2]) > 59 || Number(r[3] || 0) > 59) return null;
  return `${r[1].padStart(2, '0')}:${r[2]}:${r[3] || '00'}`;
}

module.exports = { leerCsv, leerNumero, leerFecha, leerHora, normalizarEncabezado };
