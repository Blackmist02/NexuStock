import { fmtCLP, fmtFecha, fmtFechaCorta, fmtNum } from "@/lib/format";
import { maximoLindo, MONO } from "./util";

export interface SemanaVenta {
  semana: string;
  ventas_clp: number;
  ventas_kg: number;
}

const W = 520;
const H = 190;
const PL = 54;
const PR = 10;
const PT = 12;
const PB = 28;

/** Ventas de las últimas semanas (barras de monto en CLP). */
export function BarrasSemanas({ semanas }: { semanas: SemanaVenta[] }) {
  const n = semanas.length;
  const ymax = maximoLindo(Math.max(0, ...semanas.map((s) => s.ventas_clp)) * 1.08);
  const paso = (W - PL - PR) / Math.max(1, n);
  const y = (v: number) => PT + (1 - v / ymax) * (H - PT - PB);
  const ticks = [0, 1, 2, 3].map((k) => (ymax * k) / 3);
  const corto = (v: number) => (v >= 1_000_000 ? `${fmtNum(v / 1_000_000, 1)} M` : v >= 1000 ? `${fmtNum(v / 1000, 0)} mil` : fmtNum(v, 0));
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Ventas por semana: ${semanas.map((s) => `semana del ${fmtFecha(s.semana)} ${fmtCLP(s.ventas_clp)}`).join(", ")}`} style={{ display: "block", maxHeight: 220 }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PL} y1={y(t)} x2={W - PR} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={PL - 7} y={y(t) + 3.5} textAnchor="end" fontFamily={MONO} fontSize="10" fill="var(--ink-muted)">
            {corto(t)}
          </text>
        </g>
      ))}
      {semanas.map((s, i) => {
        const bw = paso * 0.56;
        const x0 = PL + i * paso + (paso - bw) / 2;
        return (
          <g key={s.semana}>
            <rect x={x0} y={y(s.ventas_clp)} width={bw} height={y(0) - y(s.ventas_clp)} rx="3" fill={i === n - 1 ? "var(--accent)" : "var(--accent-2)"}>
              <title>{`Semana del ${fmtFecha(s.semana)}\n${fmtCLP(s.ventas_clp)} · ${fmtNum(s.ventas_kg)} kg`}</title>
            </rect>
            <text x={x0 + bw / 2} y={H - 10} textAnchor="middle" fontFamily={MONO} fontSize="10" fill="var(--ink-muted)">
              {fmtFechaCorta(s.semana)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
