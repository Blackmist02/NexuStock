// CSV amigable para Excel en español (separador «;», decimales con coma y BOM UTF-8).
const celda = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** columnas: [{ titulo, valor: (fila) => any }] */
function toCsv(columnas, filas) {
  const lineas = [columnas.map((c) => celda(c.titulo)).join(';')];
  for (const f of filas) lineas.push(columnas.map((c) => celda(c.valor(f))).join(';'));
  return `﻿${lineas.join('\r\n')}\r\n`;
}

function enviarCsv(res, nombreArchivo, columnas, filas) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  res.send(toCsv(columnas, filas));
}

module.exports = { toCsv, enviarCsv };
