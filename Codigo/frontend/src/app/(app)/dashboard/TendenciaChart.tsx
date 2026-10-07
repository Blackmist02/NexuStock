import { fmtFecha, fmtFechaCorta, fmtNum } from "@/lib/format";

export interface PuntoTendencia {
  semana: string; // lunes de la semana, AAAA-MM-DD
  real: number | null;
  proyectada: number | null;
  es_futuro: boolean;
}

const W = 640;
const H = 236;
const PL = 46;
const PR = 18;
const PT = 14;
const PB = 30;

function maximoLindo(max: number): number {
  if (!(max > 0)) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

/** Tendencia semanal: demanda real (línea sólida) vs. proyectada (línea punteada). SVG propio, sin librerías. */
export function TendenciaChart({ serie }: { serie: PuntoTendencia[] }) {
  const n = serie.length;
  const valores = serie.flatMap((s) => [s.real, s.proyectada]).filter((v): v is number => v !== null);
  const ymax = maximoLindo(Math.max(0, ...valores) * 1.05);
  const x = (i: number) => PL + (i * (W - PL - PR)) / Math.max(1, n - 1);
  const y = (v: number) => PT + (1 - v / ymax) * (H - PT - PB);
  const idxHoy = serie.reduce((acc, s, i) => (!s.es_futuro ? i : acc), 0);
  const ticks = [0, 1, 2, 3, 4].map((k) => (ymax * k) / 4);

  const tramos = (clave: "real" | "proyectada") => {
    const out: { i: number; v: number }[][] = [];
    let cur: { i: number; v: number }[] = [];
    serie.forEach((s, i) => {
      const v = s[clave];
      if (v === null) {
        if (cur.length) out.push(cur);
        cur = [];
      } else cur.push({ i, v });
    });
    if (cur.length) out.push(cur);
    return out;
  };
  const path = (t: { i: number; v: number }[]) => t.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const resumen = serie
    .map((s) => `Semana del ${fmtFecha(s.semana)}: real ${s.real === null ? "sin dato" : fmtNum(s.real)}, proyectada ${s.proyectada === null ? "sin dato" : fmtNum(s.proyectada)}`)
    .join(". ");

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tendencia semanal de demanda real y proyectada. ${resumen}`} style={{ display: "block", maxHeight: 280 }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PL} y1={y(t)} x2={W - PR} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={PL - 8} y={y(t) + 3.5} textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize="10" fill="var(--ink-muted)">
            {fmtNum(t, ymax >= 20 ? 0 : 1)}
          </text>
        </g>
      ))}
      <line x1={x(idxHoy)} y1={PT - 4} x2={x(idxHoy)} y2={H - PB} stroke="var(--accent)" strokeWidth="1.2" strokeDasharray="3,3" />
      {tramos("real").map((t, k) => (
        <path key={`r${k}`} d={path(t)} fill="none" stroke="var(--ink-muted)" strokeWidth="2.5" strokeLinejoin="round" />
      ))}
      {tramos("proyectada").map((t, k) => (
        <path key={`p${k}`} d={path(t)} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="6,4" strokeLinejoin="round" />
      ))}
      {serie.map((s, i) => (
        <g key={s.semana}>
          {s.real !== null ? <circle cx={x(i)} cy={y(s.real)} r="3.2" fill="var(--ink-muted)" /> : null}
          {s.proyectada !== null ? <circle cx={x(i)} cy={y(s.proyectada)} r="3.2" fill="var(--accent)" /> : null}
          <rect x={x(i) - (W - PL - PR) / (2 * (n - 1))} y={PT} width={(W - PL - PR) / (n - 1)} height={H - PT - PB} fill="transparent">
            <title>{`Semana del ${fmtFecha(s.semana)}${i === idxHoy ? " (en curso)" : ""}\nReal: ${s.real === null ? "—" : fmtNum(s.real)}\nProyectada: ${s.proyectada === null ? "—" : fmtNum(s.proyectada)}`}</title>
          </rect>
          <text x={x(i)} y={H - 10} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="10" fill={i === idxHoy ? "var(--ink)" : "var(--ink-muted)"} fontWeight={i === idxHoy ? 600 : 400}>
            {i === idxHoy ? "Esta sem." : fmtFechaCorta(s.semana)}
          </text>
        </g>
      ))}
    </svg>
  );
}
