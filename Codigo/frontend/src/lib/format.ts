/** Formato es-CL: pesos chilenos, kilos con coma decimal y fechas dd/mm/aaaa. */
const TZ = "America/Santiago";

const clp = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
export const fmtCLP = (n: number | null | undefined): string => (n == null ? "—" : clp.format(n));

const num = (d: number) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: d });
const n1 = num(1);
const n0 = num(0);
const n2 = num(2);
export const fmtNum = (n: number | null | undefined, decimales: 0 | 1 | 2 = 1): string =>
  n == null ? "—" : (decimales === 0 ? n0 : decimales === 2 ? n2 : n1).format(n);

/** "12,5 kg" o "8 un" */
export const fmtCant = (n: number | null | undefined, unidad: "kg" | "un" | string): string =>
  n == null ? "—" : `${unidad === "un" ? n0.format(n) : n1.format(n)} ${unidad}`;

export const fmtPct = (n: number | null | undefined, decimales = 0): string =>
  n == null ? "—" : `${num(decimales).format(n)} %`;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-10-04" (fecha de calendario) → "04/10/2026" */
export function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** "2026-10-04" → "4 oct" */
export function fmtFechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)} ${MESES[Number(m) - 1]}`;
}

/** Instante ISO (UTC) → "04/10/2026 · 11:20" en hora de la carnicería */
export function fmtFechaHora(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("es-CL", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} · ${g("hour")}:${g("minute")}`;
}

/** Fecha de hoy (AAAA-MM-DD) en la zona de la carnicería. */
export function hoyISO(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p; // en-CA → AAAA-MM-DD
}

/** Valor para <input type="datetime-local"> con la hora actual de la carnicería. */
export function ahoraLocalInput(): string {
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date());
  return p.replace(" ", "T");
}

export const DIAS_SEMANA = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]; // ISO 1..7

/** Texto → número aceptando coma o punto decimal ("3,4" / "1.250,5"). null si no es válido. */
export function parseNum(txt: string): number | null {
  let s = txt.trim().replace(/\s/g, "").replace(/[$kg]/gi, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const NIVEL_LABEL = { quiebre: "Quiebre", bajo: "Bajo", optimo: "Óptimo" } as const;
export type Nivel = keyof typeof NIVEL_LABEL;
/** Clase de .badge para cada nivel del semáforo */
export const NIVEL_BADGE: Record<Nivel, string> = { quiebre: "badge quiebre", bajo: "badge alerta", optimo: "badge saludable" };
