"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DIAS_SEMANA, fmtFecha, fmtFechaCorta, fmtNum } from "@/lib/format";
import type { Evento } from "@/lib/tipos";
import { maximoLindo, MONO } from "./util";

export interface DiaSerie {
  fecha: string;
  real: number | null;
  proyectada: number | null;
}

export interface SemanaSerie {
  semana: string; // lunes, AAAA-MM-DD
  tipo: "pasada" | "en_curso" | "futura";
  real: number | null;
  proyectada: number | null;
  origen: string | null;
}

type Vista = "semanas" | "dias";

interface Punto {
  clave: string; // fecha del día o lunes de la semana
  desde: string;
  hasta: string;
  real: number | null;
  proyectada: number | null;
  futuro: boolean;
}

const H = 290; // alto fijo en píxeles; el ancho es el del contenedor (el texto no se agranda en pantallas anchas)
const PL = 44;
const PR = 14;
const PT = 26;
const PB = 30;
const NAV_H = 44;
const FESTIVOS = new Set(["fiestas_patrias", "semana_santa", "feriado_largo", "feriado"]);
// La Cuaresma dura seis semanas: se informa en el detalle, pero no se sombrea
const esFestivo = (e: Evento) => FESTIVOS.has(e.tipo) && !e.nombre.startsWith("Cuaresma");

/** Eventos sin repetir: uno por nombre, con su primer y último día dentro del periodo. */
function agruparEventos(evs: Evento[]): string[] {
  const m = new Map<string, { desde: string; hasta: string }>();
  for (const e of evs) {
    const r = m.get(e.nombre);
    m.set(e.nombre, r ? { desde: r.desde < e.fecha ? r.desde : e.fecha, hasta: r.hasta > e.fecha ? r.hasta : e.fecha } : { desde: e.fecha, hasta: e.fecha });
  }
  return [...m].map(([nombre, r]) => (r.desde === r.hasta ? `${fmtFechaCorta(r.desde)} · ${nombre}` : `${nombre} (${fmtFechaCorta(r.desde)} al ${fmtFechaCorta(r.hasta)})`));
}
const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const sumarDias = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const difDias = (a: string, b: string) => {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  return Math.round((Date.UTC(pa[0], pa[1] - 1, pa[2]) - Date.UTC(pb[0], pb[1] - 1, pb[2])) / 86400000);
};
const diaIso = (iso: string) => {
  const wd = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return wd === 0 ? 7 : wd;
};
const finDeMes = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const maxIso = (a: string, b: string) => (a > b ? a : b);
const minIso = (a: string, b: string) => (a < b ? a : b);

/**
 * Demanda de un producto con zoom: venta real (sólida), predicción registrada en semanas pasadas y proyección desde la
 * semana en curso (punteadas). Se ve por semanas o por días; se acerca arrastrando sobre el gráfico, con los botones,
 * eligiendo un mes o haciendo clic en una semana. SVG propio, sin librerías.
 */
export function GraficoDemanda({ dias, semanas, eventos, unidad, hoy }: { dias: DiaSerie[]; semanas: SemanaSerie[]; eventos: Evento[]; unidad: string; hoy: string }) {
  const inicio = dias[0]?.fecha ?? hoy;
  const fin = dias[dias.length - 1]?.fecha ?? hoy;
  const [vista, setVista] = useState<Vista>("semanas");
  const [ventana, setVentana] = useState<[string, string]>([inicio, fin]);
  const [hover, setHover] = useState<number | null>(null);
  const [arrastre, setArrastre] = useState<{ x0: number; x1: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const contRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = contRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Si cambia el rango pedido (otro producto o meses), la ventana vuelve a abarcarlo todo
  const claveRango = `${inicio}|${fin}`;
  const [rangoVisto, setRangoVisto] = useState(claveRango);
  if (rangoVisto !== claveRango) {
    setRangoVisto(claveRango);
    setVentana([inicio, fin]);
    setVista("semanas");
    setHover(null);
  }

  const [v0, v1] = ventana;
  const lunesHoy = sumarDias(hoy, -(diaIso(hoy) - 1));

  const puntos: Punto[] = useMemo(() => {
    if (vista === "dias") {
      return dias
        .filter((d) => d.fecha >= v0 && d.fecha <= v1)
        .map((d) => ({ clave: d.fecha, desde: d.fecha, hasta: d.fecha, real: d.real, proyectada: d.proyectada, futuro: d.fecha >= hoy }));
    }
    return semanas
      .filter((s) => sumarDias(s.semana, 6) >= v0 && s.semana <= v1)
      .map((s) => ({ clave: s.semana, desde: s.semana, hasta: sumarDias(s.semana, 6), real: s.real, proyectada: s.proyectada, futuro: s.tipo !== "pasada" }));
  }, [vista, dias, semanas, v0, v1, hoy]);

  const n = puntos.length;
  const valores = puntos.flatMap((p) => [p.real, p.proyectada]).filter((v): v is number => v !== null);
  const ymax = maximoLindo(Math.max(0, ...valores) * 1.1);
  const ancho = W - PL - PR;
  const x = (i: number) => PL + (n <= 1 ? ancho / 2 : (i * ancho) / (n - 1));
  const y = (v: number) => PT + (1 - v / ymax) * (H - PT - PB);
  const paso = n <= 1 ? ancho : ancho / (n - 1);
  const ticks = [0, 1, 2, 3, 4].map((k) => (ymax * k) / 4);

  const tramos = (clave: "real" | "proyectada", filtro: (p: Punto) => boolean) => {
    const out: { i: number; v: number }[][] = [];
    let cur: { i: number; v: number }[] = [];
    puntos.forEach((p, i) => {
      const v = p[clave];
      if (v === null || !filtro(p)) {
        if (cur.length) out.push(cur);
        cur = [];
      } else cur.push({ i, v });
    });
    if (cur.length) out.push(cur);
    return out;
  };
  const ruta = (t: { i: number; v: number }[]) => t.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  // La predicción registrada (pasado) y la proyección (desde la semana en curso) se dibujan por separado
  const esPasado = (p: Punto) => p.hasta < lunesHoy;
  const tramoRegistrada = tramos("proyectada", esPasado);
  const tramoProyeccion = tramos("proyectada", (p) => !esPasado(p));

  const eventosPorDia = useMemo(() => {
    const m = new Map<string, Evento[]>();
    for (const e of eventos) m.set(e.fecha, [...(m.get(e.fecha) ?? []), e]);
    return m;
  }, [eventos]);
  const eventosDe = (p: Punto) => {
    const out: Evento[] = [];
    for (let f = p.desde; f <= p.hasta; f = sumarDias(f, 1)) out.push(...(eventosPorDia.get(f) ?? []));
    return out;
  };
  const festivos = puntos.map((p, i) => ({ i, evs: eventosDe(p).filter(esFestivo) })).filter((f) => f.evs.length);

  // Posición de "hoy" y de los cambios de mes
  const idxHoy = puntos.findIndex((p) => p.desde <= hoy && hoy <= p.hasta);
  const cortesMes = puntos
    .map((p, i) => ({ i, p }))
    .filter(({ p, i }) => i > 0 && (vista === "dias" ? p.desde.slice(8) === "01" : p.desde.slice(0, 7) !== puntos[i - 1].desde.slice(0, 7)));

  // Una etiqueta cada ~64 px, a intervalos regulares; por días, si caben pocas, una por lunes
  const etiquetaCada = Math.max(1, Math.ceil(64 / Math.max(1, paso)));
  const conEtiqueta = (p: Punto, i: number) => (vista === "dias" && etiquetaCada >= 4 && etiquetaCada <= 7 ? diaIso(p.desde) === 1 : i % etiquetaCada === 0);
  const etiqueta = (p: Punto) => (vista === "dias" && n <= 16 ? `${DIAS_SEMANA[diaIso(p.desde)]} ${Number(p.desde.slice(8))}` : fmtFechaCorta(p.desde));

  // --- Zoom
  const aplicarVentana = (a: string, b: string, preferir?: Vista) => {
    const a2 = maxIso(inicio, a);
    const b2 = minIso(fin, b);
    if (difDias(b2, a2) < 2) return;
    setVentana([a2, b2]);
    setHover(null);
    const span = difDias(b2, a2) + 1;
    setVista(preferir ?? (span <= 45 ? "dias" : vista));
  };
  const centro = () => sumarDias(v0, Math.floor(difDias(v1, v0) / 2));
  const acercar = () => {
    const mitad = Math.max(3, Math.floor((difDias(v1, v0) + 1) / 4));
    const c = centro();
    aplicarVentana(sumarDias(c, -mitad), sumarDias(c, mitad));
  };
  const alejar = () => {
    const span = difDias(v1, v0) + 1;
    const c = centro();
    const a = sumarDias(c, -span);
    const b = sumarDias(c, span);
    setVentana([maxIso(inicio, a), minIso(fin, b)]);
    if (difDias(minIso(fin, b), maxIso(inicio, a)) > 45) setVista("semanas");
    setHover(null);
  };
  const desplazar = (sentido: -1 | 1) => {
    const span = difDias(v1, v0);
    const salto = Math.max(1, Math.floor((span + 1) / 2)) * sentido;
    let a = sumarDias(v0, salto);
    let b = sumarDias(v1, salto);
    if (a < inicio) { a = inicio; b = sumarDias(inicio, span); }
    if (b > fin) { b = fin; a = sumarDias(fin, -span); }
    setVentana([a, b]);
    setHover(null);
  };
  const restablecer = () => { setVentana([inicio, fin]); setVista("semanas"); setHover(null); };
  const completo = v0 === inicio && v1 === fin;

  const meses = useMemo(() => {
    const out: { clave: string; texto: string; desde: string; hasta: string }[] = [];
    for (let f = `${inicio.slice(0, 7)}-01`; f <= fin; f = sumarDias(finDeMes(f), 1)) {
      const [yy, mm] = f.split("-").map(Number);
      const desde = maxIso(inicio, f);
      const hasta = minIso(fin, finDeMes(f));
      // Solo meses con al menos una semana dentro del rango (un mes con 3 días visibles no aporta)
      if (difDias(hasta, desde) >= 6) out.push({ clave: f.slice(0, 7), texto: `${MESES_LARGO[mm - 1].slice(0, 3)} ${String(yy).slice(2)}`, desde, hasta });
    }
    return out;
  }, [inicio, fin]);
  const mesActivo = meses.find((m) => m.desde === v0 && m.hasta === v1)?.clave;

  // --- Interacción con el puntero sobre el área del gráfico
  const aSvgX = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    return r ? ((clientX - r.left) / r.width) * W : 0;
  };
  const indiceEn = (sx: number) => (n <= 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round(((sx - PL) / ancho) * (n - 1)))));
  const onDown = (e: ReactPointerEvent<SVGRectElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const sx = aSvgX(e.clientX);
    setArrastre({ x0: sx, x1: sx });
  };
  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const sx = aSvgX(e.clientX);
    setHover(indiceEn(sx));
    if (arrastre) setArrastre({ ...arrastre, x1: sx });
  };
  const onUp = () => {
    if (!arrastre) return;
    const { x0, x1 } = arrastre;
    setArrastre(null);
    const i0 = indiceEn(Math.min(x0, x1));
    const i1 = indiceEn(Math.max(x0, x1));
    if (Math.abs(x1 - x0) < 8 || i0 === i1) {
      // Clic: en vista semanal se abre la semana día a día
      const p = puntos[i0];
      if (vista === "semanas" && p) aplicarVentana(p.desde, p.hasta, "dias");
      return;
    }
    aplicarVentana(puntos[i0].desde, puntos[i1].hasta);
  };

  // --- Navegador (vista general con la ventana resaltada)
  const navRef = useRef<SVGSVGElement>(null);
  const totalDias = difDias(fin, inicio) + 1;
  const nx = (iso: string) => PL + (difDias(iso, inicio) / Math.max(1, totalDias - 1)) * ancho;
  const navMax = maximoLindo(Math.max(0, ...semanas.flatMap((s) => [s.real ?? 0, s.proyectada ?? 0])) * 1.1);
  const navY = (v: number) => 4 + (1 - v / navMax) * (NAV_H - 10);
  const navRuta = (clave: "real" | "proyectada") =>
    semanas
      .filter((s) => s[clave] !== null)
      .map((s, k) => `${k ? "L" : "M"}${nx(sumarDias(s.semana, 3)).toFixed(1)},${navY(s[clave] as number).toFixed(1)}`)
      .join(" ");
  const onNav = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.type === "pointermove" && e.buttons !== 1) return;
    const r = navRef.current?.getBoundingClientRect();
    if (!r) return;
    const sx = ((e.clientX - r.left) / r.width) * W;
    const dia = sumarDias(inicio, Math.round(((sx - PL) / ancho) * (totalDias - 1)));
    const span = difDias(v1, v0);
    let a = sumarDias(dia, -Math.floor(span / 2));
    let b = sumarDias(a, span);
    if (a < inicio) { a = inicio; b = sumarDias(inicio, span); }
    if (b > fin) { b = fin; a = sumarDias(fin, -span); }
    setVentana([a, b]);
  };

  const pHover = hover !== null ? puntos[hover] : null;
  const evHover = pHover ? eventosDe(pHover) : [];
  const resumen = `Demanda ${vista === "dias" ? "diaria" : "semanal"} en ${unidad} del ${fmtFecha(v0)} al ${fmtFecha(v1)}. ${puntos
    .filter((p) => p.real !== null || p.proyectada !== null)
    .slice(0, 40)
    .map((p) => `${fmtFechaCorta(p.desde)}: real ${p.real === null ? "sin dato" : fmtNum(p.real)}, proyectada ${p.proyectada === null ? "sin dato" : fmtNum(p.proyectada)}`)
    .join(". ")}`;

  return (
    <div className="grafico-demanda" ref={contRef}>
      <div className="gd-barra">
        <div className="chips" role="group" aria-label="Agrupar por">
          <button type="button" className={`chip${vista === "semanas" ? " on" : ""}`} aria-pressed={vista === "semanas"} onClick={() => { setVista("semanas"); setHover(null); }}>Semanas</button>
          <button type="button" className={`chip${vista === "dias" ? " on" : ""}`} aria-pressed={vista === "dias"} onClick={() => { setVista("dias"); setHover(null); }}>Días</button>
        </div>
        <div className="gd-zoom" role="group" aria-label="Zoom">
          <button type="button" className="gd-btn" aria-label="Retroceder" title="Retroceder" disabled={v0 <= inicio} onClick={() => desplazar(-1)}>‹</button>
          <button type="button" className="gd-btn" aria-label="Alejar" title="Alejar" disabled={completo} onClick={alejar}>−</button>
          <button type="button" className="gd-btn" aria-label="Acercar" title="Acercar" disabled={difDias(v1, v0) < 6} onClick={acercar}>+</button>
          <button type="button" className="gd-btn" aria-label="Avanzar" title="Avanzar" disabled={v1 >= fin} onClick={() => desplazar(1)}>›</button>
          <button type="button" className="gd-btn gd-texto" disabled={completo && vista === "semanas"} onClick={restablecer}>Ver todo</button>
        </div>
      </div>
      <div className="chips gd-meses" role="group" aria-label="Ir a un mes">
        {meses.map((m) => (
          <button key={m.clave} type="button" className={`chip${mesActivo === m.clave ? " on" : ""}`} aria-pressed={mesActivo === m.clave} onClick={() => aplicarVentana(m.desde, m.hasta, "dias")}>
            {m.texto}
          </button>
        ))}
      </div>

      <div className="gd-lienzo">
        <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={resumen} style={{ display: "block", touchAction: "none" }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PL} y1={y(t)} x2={W - PR} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
              <text x={PL - 7} y={y(t) + 3.5} textAnchor="end" fontFamily={MONO} fontSize="10" fill="var(--ink-muted)">
                {fmtNum(t, ymax >= 20 ? 0 : 1)}
              </text>
            </g>
          ))}
          {festivos.map(({ i, evs }) => (
            <g key={`f${puntos[i].clave}`}>
              <rect x={x(i) - paso / 2} y={PT} width={paso} height={H - PT - PB} fill="var(--alerta-bg)" />
              <text x={x(i)} y={PT + 10} textAnchor="middle" fontSize="11" fill="var(--alerta)">
                ★<title>{agruparEventos(evs).join("\n")}</title>
              </text>
            </g>
          ))}
          {cortesMes.map(({ i, p }) => (
            <g key={`m${p.clave}`}>
              <line x1={x(i) - paso / 2} y1={PT - 12} x2={x(i) - paso / 2} y2={H - PB} stroke="var(--border-strong)" strokeWidth="1" />
              <text x={x(i) - paso / 2 + 4} y={PT - 4} fontFamily={MONO} fontSize="10" fill="var(--ink-muted)">
                {MESES_LARGO[Number(p.desde.slice(5, 7)) - 1]}
              </text>
            </g>
          ))}
          {idxHoy >= 0 ? (
            <g>
              <line x1={x(idxHoy)} y1={PT - 12} x2={x(idxHoy)} y2={H - PB} stroke="var(--accent)" strokeWidth="1.2" strokeDasharray="3,3" />
              <text x={x(idxHoy) + (x(idxHoy) > W - PR - 30 ? -4 : 4)} y={H - PB - 5} textAnchor={x(idxHoy) > W - PR - 30 ? "end" : "start"} fontFamily={MONO} fontSize="10" fill="var(--accent)">Hoy</text>
            </g>
          ) : null}
          {tramoRegistrada.map((t, k) => (
            <path key={`g${k}`} d={ruta(t)} fill="none" stroke="var(--accent)" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="4,4" strokeLinejoin="round" />
          ))}
          {tramos("real", () => true).map((t, k) => (
            <path key={`r${k}`} d={ruta(t)} fill="none" stroke="var(--ink-muted)" strokeWidth="2.3" strokeLinejoin="round" />
          ))}
          {tramoProyeccion.map((t, k) => (
            <path key={`p${k}`} d={ruta(t)} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="6,4" strokeLinejoin="round" />
          ))}
          {paso >= 9
            ? puntos.map((p, i) => (
                <g key={`c${p.clave}`}>
                  {p.real !== null ? <circle cx={x(i)} cy={y(p.real)} r="2.8" fill="var(--ink-muted)" /> : null}
                  {p.proyectada !== null ? <circle cx={x(i)} cy={y(p.proyectada)} r="2.8" fill="var(--accent)" fillOpacity={esPasado(p) ? 0.55 : 1} /> : null}
                </g>
              ))
            : null}
          {puntos.map((p, i) =>
            conEtiqueta(p, i) ? (
              <text key={`l${p.clave}`} x={x(i)} y={H - 10} textAnchor={x(i) > W - PR - 24 ? "end" : x(i) < PL + 10 ? "start" : "middle"} fontFamily={MONO} fontSize="10" fill={i === idxHoy ? "var(--ink)" : "var(--ink-muted)"} fontWeight={i === idxHoy ? 600 : 400}>
                {etiqueta(p)}
              </text>
            ) : null,
          )}
          {pHover && hover !== null ? (
            <g pointerEvents="none">
              <line x1={x(hover)} y1={PT} x2={x(hover)} y2={H - PB} stroke="var(--ink-muted)" strokeWidth="1" strokeOpacity="0.6" />
              {pHover.real !== null ? <circle cx={x(hover)} cy={y(pHover.real)} r="4.5" fill="var(--ink-muted)" stroke="var(--surface)" strokeWidth="1.5" /> : null}
              {pHover.proyectada !== null ? <circle cx={x(hover)} cy={y(pHover.proyectada)} r="4.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" /> : null}
            </g>
          ) : null}
          {arrastre && Math.abs(arrastre.x1 - arrastre.x0) >= 8 ? (
            <rect x={Math.min(arrastre.x0, arrastre.x1)} y={PT} width={Math.abs(arrastre.x1 - arrastre.x0)} height={H - PT - PB} fill="var(--accent)" fillOpacity="0.12" stroke="var(--accent)" strokeOpacity="0.5" pointerEvents="none" />
          ) : null}
          <rect
            x={PL - paso / 2}
            y={PT}
            width={ancho + paso}
            height={H - PT - PB}
            fill="transparent"
            style={{ cursor: vista === "semanas" ? "zoom-in" : "crosshair" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => { if (!arrastre) setHover(null); }}
          />
        </svg>
        {pHover ? (
          <div className="gd-tooltip" style={{ left: `${(x(hover!) / W) * 100}%`, transform: x(hover!) > W * 0.62 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }} role="status">
            <b>{vista === "dias" ? `${DIAS_SEMANA[diaIso(pHover.desde)]} ${fmtFecha(pHover.desde)}` : `Semana del ${fmtFecha(pHover.desde)}`}</b>
            {pHover.desde <= hoy && hoy <= pHover.hasta ? <span className="gd-tag">{vista === "dias" ? "hoy" : "en curso"}</span> : null}
            <div>Real: <b>{pHover.real === null ? "—" : `${fmtNum(pHover.real)} ${unidad}`}</b></div>
            <div>{esPasado(pHover) ? "Predicción registrada" : "Proyección"}: <b>{pHover.proyectada === null ? "—" : `${fmtNum(pHover.proyectada)} ${unidad}`}</b></div>
            {pHover.real !== null && pHover.proyectada !== null && esPasado(pHover) ? (
              <div>Diferencia: <b>{fmtNum(pHover.real - pHover.proyectada)} {unidad}</b></div>
            ) : null}
            {evHover.length ? <div className="gd-ev">{agruparEventos(evHover).map((t) => <div key={t}>{t}</div>)}</div> : null}
            {vista === "semanas" ? <div className="gd-hint">Clic para ver la semana por día</div> : null}
          </div>
        ) : null}
      </div>

      <svg ref={navRef} width={W} height={NAV_H} viewBox={`0 0 ${W} ${NAV_H}`} className="gd-nav" aria-label="Vista general: arrastra para mover el periodo visible" role="slider" aria-valuetext={`${fmtFecha(v0)} a ${fmtFecha(v1)}`} style={{ display: "block", touchAction: "none" }} onPointerDown={onNav} onPointerMove={onNav}>
        <rect x={PL} y={2} width={ancho} height={NAV_H - 6} fill="var(--bg-panel)" rx="4" />
        <path d={navRuta("real")} fill="none" stroke="var(--ink-muted)" strokeWidth="1.3" />
        <path d={navRuta("proyectada")} fill="none" stroke="var(--accent)" strokeWidth="1.3" strokeDasharray="3,3" />
        {hoy >= inicio && hoy <= fin ? <line x1={nx(hoy)} y1={2} x2={nx(hoy)} y2={NAV_H - 4} stroke="var(--accent)" strokeWidth="1" /> : null}
        <rect x={nx(v0)} y={2} width={Math.max(3, nx(v1) - nx(v0))} height={NAV_H - 6} fill="var(--accent)" fillOpacity="0.14" stroke="var(--accent)" strokeOpacity="0.7" rx="3" style={{ cursor: "grab" }} />
      </svg>
      <div className="gd-pie">
        {vista === "dias" ? "Día a día" : "Por semana"} · {fmtFecha(v0)} → {fmtFecha(v1)} · Arrastra sobre el gráfico para acercar un periodo
      </div>
    </div>
  );
}
