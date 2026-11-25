import { fmtFecha, fmtFechaCorta, fmtNum } from "@/lib/format";
import type { Evento } from "@/lib/tipos";
import { maximoLindo, MONO } from "./util";

export interface PuntoDia {
  fecha: string;
  kg: number;
}

const W = 760;
const H = 250;
const PL = 42;
const PR = 14;
const PT = 16;
const PB = 30;
const FESTIVOS = new Set(["fiestas_patrias", "semana_santa", "feriado_largo", "feriado"]);

/** Demanda diaria de un producto: histórico (línea sólida), proyección (punteada), día de hoy y feriados. */
export function LineaDemanda({ historico, prediccion, eventos, unidad, hoy }: { historico: PuntoDia[]; prediccion: PuntoDia[]; eventos: Evento[]; unidad: string; hoy: string }) {
  const dias = [...historico, ...prediccion];
  const n = dias.length;
  const ymax = maximoLindo(Math.max(0, ...dias.map((d) => d.kg)) * 1.1);
  const x = (i: number) => PL + (i * (W - PL - PR)) / Math.max(1, n - 1);
  const y = (v: number) => PT + (1 - v / ymax) * (H - PT - PB);
  const idx = new Map(dias.map((d, i) => [d.fecha, i]));
  const idxHoy = historico.length - 1;
  const ticks = [0, 1, 2, 3, 4].map((k) => (ymax * k) / 4);
  const path = (pts: PuntoDia[], desde: number) => pts.map((p, k) => `${k ? "L" : "M"}${x(desde + k).toFixed(1)},${y(p.kg).toFixed(1)}`).join(" ");
  const festivos = eventos.filter((e) => FESTIVOS.has(e.tipo) && idx.has(e.fecha));
  const paso = (W - PL - PR) / Math.max(1, n - 1);
  const resumen = `Demanda diaria en ${unidad}. Promedio de los últimos días ${fmtNum(historico.reduce((a, d) => a + d.kg, 0) / Math.max(1, historico.length))}; proyección diaria ${fmtNum(prediccion[0]?.kg ?? 0)}.`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={resumen} style={{ display: "block", maxHeight: 300 }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PL} y1={y(t)} x2={W - PR} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={PL - 7} y={y(t) + 3.5} textAnchor="end" fontFamily={MONO} fontSize="10" fill="var(--ink-muted)">
            {fmtNum(t, ymax >= 20 ? 0 : 1)}
          </text>
        </g>
      ))}
      {festivos.map((e) => (
        <g key={`${e.fecha}-${e.nombre}`}>
          <rect x={x(idx.get(e.fecha)!) - paso / 2} y={PT} width={paso} height={H - PT - PB} fill="var(--alerta-bg)" />
          <text x={x(idx.get(e.fecha)!)} y={PT + 9} textAnchor="middle" fontSize="11" fill="var(--alerta)">
            ★
            <title>{`${fmtFecha(e.fecha)} · ${e.nombre}`}</title>
          </text>
        </g>
      ))}
      <line x1={x(idxHoy)} y1={PT - 4} x2={x(idxHoy)} y2={H - PB} stroke="var(--accent)" strokeWidth="1.2" strokeDasharray="3,3" />
      <text x={x(idxHoy) + 4} y={H - PB - 5} fontFamily={MONO} fontSize="10" fill="var(--accent)">
        Hoy
      </text>
      <path d={path(historico, 0)} fill="none" stroke="var(--ink-muted)" strokeWidth="2.2" strokeLinejoin="round" />
      {prediccion.length ? (
        <path d={`M${x(idxHoy).toFixed(1)},${y(historico[idxHoy]?.kg ?? 0).toFixed(1)} ${path(prediccion, historico.length).replace(/^M/, "L")}`} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeDasharray="6,4" strokeLinejoin="round" />
      ) : null}
      {dias.map((d, i) => (
        <rect key={d.fecha} x={x(i) - paso / 2} y={PT} width={paso} height={H - PT - PB} fill="transparent">
          <title>{`${fmtFecha(d.fecha)}${i > idxHoy ? " (proyección)" : ""}\n${fmtNum(d.kg)} ${unidad}`}</title>
        </rect>
      ))}
      {dias.map((d, i) =>
        i % 7 === 0 || (i === n - 1 && (n - 1) % 7 >= 3) ? (
          <text key={`l${d.fecha}`} x={x(i)} y={H - 10} textAnchor="middle" fontFamily={MONO} fontSize="10" fill={d.fecha === hoy ? "var(--ink)" : "var(--ink-muted)"}>
            {fmtFechaCorta(d.fecha)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
