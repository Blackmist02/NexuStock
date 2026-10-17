import { fmtFecha, fmtFechaCorta, fmtNum } from "@/lib/format";
import { maximoLindo, MONO } from "./util";

export interface PuntoMovimiento {
  fecha: string;
  compras: number;
  ventas: number;
}

const W = 640;
const H = 210;
const PL = 40;
const PR = 10;
const PT = 10;
const PB = 28;

/** Compras y ventas de los últimos 30 días (barras agrupadas por día). */
export function BarrasMovimientos({ serie, unidad }: { serie: PuntoMovimiento[]; unidad: string }) {
  const n = serie.length;
  const ymax = maximoLindo(Math.max(0, ...serie.flatMap((s) => [s.compras, s.ventas])) * 1.08);
  const paso = (W - PL - PR) / Math.max(1, n);
  const y = (v: number) => PT + (1 - v / ymax) * (H - PT - PB);
  const base = y(0);
  const ticks = [0, 1, 2, 3].map((k) => (ymax * k) / 3);
  const resumen = `Compras y ventas diarias de los últimos ${n} días. Total comprado ${fmtNum(serie.reduce((a, s) => a + s.compras, 0))} ${unidad}, total vendido ${fmtNum(serie.reduce((a, s) => a + s.ventas, 0))} ${unidad}.`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={resumen} style={{ display: "block", maxHeight: 240 }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PL} y1={y(t)} x2={W - PR} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={PL - 6} y={y(t) + 3.5} textAnchor="end" fontFamily={MONO} fontSize="10" fill="var(--ink-muted)">
            {fmtNum(t, ymax >= 20 ? 0 : 1)}
          </text>
        </g>
      ))}
      {serie.map((s, i) => {
        const x0 = PL + i * paso + paso * 0.14;
        const bw = (paso * 0.72) / 2;
        return (
          <g key={s.fecha}>
            {s.compras > 0 ? <rect x={x0} y={y(s.compras)} width={bw} height={base - y(s.compras)} rx="1.5" fill="var(--accent-2)" /> : null}
            {s.ventas > 0 ? <rect x={x0 + bw + 1} y={y(s.ventas)} width={bw} height={base - y(s.ventas)} rx="1.5" fill="var(--accent)" /> : null}
            <rect x={PL + i * paso} y={PT} width={paso} height={H - PT - PB} fill="transparent">
              <title>{`${fmtFecha(s.fecha)}\nCompras: ${fmtNum(s.compras)} ${unidad}\nVentas: ${fmtNum(s.ventas)} ${unidad}`}</title>
            </rect>
            {(n - 1 - i) % 5 === 0 ? (
              <text x={PL + i * paso + paso / 2} y={H - 10} textAnchor="middle" fontFamily={MONO} fontSize="10" fill="var(--ink-muted)">
                {fmtFechaCorta(s.fecha)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
