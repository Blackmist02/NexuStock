/**
 * Recorte de un CSV de carga antes de enviarlo: quita las filas del inicio anteriores al último día ya cargado y las
 * del final posteriores a la fecha límite, para no subir el año completo en cada tramo. Solo quita filas de los
 * extremos con fecha legible (las del medio y las dudosas las revisa el servidor). El servidor recibe cuántas se
 * omitieron y cuántas líneas se saltaron al inicio, así el resumen y los números de línea de los errores cuadran.
 * Si el archivo tiene comillas (celdas que podrían contener saltos de línea) se envía completo.
 */

export interface Recorte {
  lineas_omitidas: number;
  ya_cargadas: number;
  posteriores: number;
}

const normalizar = (h: string) =>
  h.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const COLUMNAS_FECHA = ["fecha", "fecha_recepcion", "dia", "fecha_hora"];

/** AAAA-MM-DD de una celda (AAAA-MM-DD, DD/MM/AAAA o DD-MM-AAAA, con o sin hora), o null. */
function fechaDe(celda: string | undefined): string | null {
  const s = (celda ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/**
 * `desde`: último día ya cargado de este tipo (sus filas se envían: el servidor decide por la hora); `hasta`: fecha
 * límite (vacía = sin límite). Devuelve el texto a enviar y el recorte, o null si no se recortó nada.
 */
export function recortarCsv(texto: string, desde: string | null, hasta: string | null): { texto: string; recorte: Recorte } | null {
  if (texto.includes('"') || (!desde && !hasta)) return null;
  const limpio = texto.replace(/^﻿/, "");
  const lineas = limpio.split(/\r?\n/);
  const cab = lineas[0] ?? "";
  const sep = (cab.match(/;/g) || []).length >= (cab.match(/,/g) || []).length ? ";" : ",";
  const columnas = cab.split(sep).map(normalizar);
  const col = COLUMNAS_FECHA.map((c) => columnas.indexOf(c)).find((i) => i >= 0);
  if (col === undefined) return null;

  const vacia = (l: string) => l.trim() === "" || l.split(sep).every((c) => c.trim() === "");
  const fecha = (l: string) => fechaDe(l.split(sep)[col]);

  // Inicio: filas vacías o anteriores al último día cargado
  let ini = 1;
  let ya = 0;
  while (ini < lineas.length) {
    const l = lineas[ini];
    if (vacia(l)) { ini++; continue; }
    const f = fecha(l);
    if (!desde || !f || f >= desde) break;
    ya++;
    ini++;
  }
  // Final: filas vacías o posteriores a la fecha límite
  let fin = lineas.length - 1;
  let post = 0;
  while (fin >= ini) {
    const l = lineas[fin];
    if (vacia(l)) { fin--; continue; }
    const f = fecha(l);
    if (!hasta || !f || f <= hasta) break;
    post++;
    fin--;
  }
  if (!ya && !post) return null;
  return {
    texto: [cab, ...lineas.slice(ini, fin + 1)].join("\r\n") + "\r\n",
    recorte: { lineas_omitidas: ini - 1, ya_cargadas: ya, posteriores: post },
  };
}
