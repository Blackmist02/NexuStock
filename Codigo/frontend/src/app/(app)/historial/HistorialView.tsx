"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { BarrasSemanas, type SemanaVenta } from "@/components/charts/BarrasSemanas";
import { Button } from "@/components/ui/Field";
import { EmptyState, ErrorState, Loading, Pagination } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { fmtCant, fmtCLP, fmtFechaHora, fmtNum, hoyISO } from "@/lib/format";
import type { Movimiento } from "@/lib/tipos";
import { useApi } from "@/lib/useApi";

interface Historial {
  desde: string;
  hasta: string;
  tipo: "todos" | "ventas" | "compras";
  totales: { compras_clp: number; compras_n: number; ventas_clp: number; ventas_n: number; ventas_kg: number; productos_con_ventas: number; productos_activos: number };
  movimientos: Movimiento[];
  total: number;
  page: number;
  pageSize: number;
  semanas: SemanaVenta[];
}

const PAGE = 25;
const primeroDeMes = () => `${hoyISO().slice(0, 8)}01`;
const ultimoDeMes = () => {
  const [y, m] = hoyISO().split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

export function HistorialView() {
  const toast = useToast();
  const [desde, setDesde] = useState(primeroDeMes());
  const [hasta, setHasta] = useState(ultimoDeMes());
  const [tipo, setTipo] = useState<"todos" | "ventas" | "compras">("todos");
  const [page, setPage] = useState(1);

  const rangoOk = !!desde && !!hasta && desde <= hasta;
  const { data, error, loading, obsoleto, reload } = useApi<Historial>(rangoOk ? "/history" : null, { desde, hasta, tipo, page, pageSize: PAGE }, { resguardo: true });

  async function exportar() {
    try {
      await api.download("/history/export.csv", { desde, hasta, tipo }, `historial-${desde}_a_${hasta}.csv`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const t = data?.totales;
  const ticket = t && t.ventas_n > 0 ? Math.round(t.ventas_clp / t.ventas_n) : null;

  return (
    <AppShell active="historial">
      <div className="topbar">
        <div>
          <h1 className="h1">Historial y reportes</h1>
          <div className="subtitle">Ventas y compras del período{obsoleto ? " · datos guardados en este dispositivo" : ""}</div>
        </div>
        <div className="topbar-right">
          <Button size="sm" onClick={() => void exportar()} disabled={!rangoOk}>Exportar CSV</Button>
        </div>
      </div>

      <div className="filters">
        <div className="chips" role="group" aria-label="Tipo de movimiento">
          {([["todos", "Todos"], ["ventas", "Ventas"], ["compras", "Compras"]] as const).map(([k, l]) => (
            <button key={k} type="button" className={`chip${tipo === k ? " on" : ""}`} aria-pressed={tipo === k} onClick={() => { setTipo(k); setPage(1); }}>{l}</button>
          ))}
        </div>
        <div className="topbar-right">
          <label className="hint" htmlFor="h-desde">Desde</label>
          <input id="h-desde" className="input surface" type="date" style={{ height: 32, width: "auto" }} value={desde} max={hasta || undefined} onChange={(e) => { setDesde(e.target.value); setPage(1); }} />
          <label className="hint" htmlFor="h-hasta">Hasta</label>
          <input id="h-hasta" className="input surface" type="date" style={{ height: 32, width: "auto" }} value={hasta} min={desde || undefined} onChange={(e) => { setHasta(e.target.value); setPage(1); }} />
        </div>
      </div>
      {!rangoOk ? <div className="callout err sticky-aviso" role="alert">Elige un rango válido: la fecha final no puede ser anterior a la inicial.</div> : null}

      {rangoOk && !data && loading ? <Loading texto="Cargando el historial…" /> : null}
      {rangoOk && !data && error ? <ErrorState message={error} onRetry={() => void reload()} /> : null}

      {data && t ? (
        <>
          <div className="grid4">
            <div className="card stat"><div className="lbl">Ventas</div><div className="val">{fmtCLP(t.ventas_clp)}</div><div className="sub">{t.ventas_n} {t.ventas_n === 1 ? "venta" : "ventas"}{ticket ? ` · ticket medio ${fmtCLP(ticket)}` : ""}</div></div>
            <div className="card stat"><div className="lbl">Compras</div><div className="val">{fmtCLP(t.compras_clp)}</div><div className="sub">{t.compras_n} {t.compras_n === 1 ? "compra" : "compras"}</div></div>
            <div className="card stat"><div className="lbl">Kilos vendidos</div><div className="val">{fmtNum(t.ventas_kg, 1)} kg</div><div className="sub">Solo productos por kilo</div></div>
            <div className="card stat"><div className="lbl">Productos con ventas</div><div className="val">{t.productos_con_ventas}</div><div className="sub">de {t.productos_activos} activos</div></div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="title">Ventas por semana · últimas 6 semanas</div>
            <BarrasSemanas semanas={data.semanas} />
          </div>

          <div className="card">
            <div className="title">Movimientos</div>
            {data.movimientos.length === 0 ? (
              <EmptyState title="Sin movimientos en este período" text="Prueba con otro rango de fechas o con otro tipo de movimiento." />
            ) : (
              <>
                <div className="scrollx">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th scope="col">Fecha y hora</th>
                        <th scope="col">Tipo</th>
                        <th scope="col">Producto</th>
                        <th scope="col">Cantidad</th>
                        <th scope="col">Monto</th>
                        <th scope="col">Proveedor</th>
                        <th scope="col">Registrado por</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.movimientos.map((m, i) => (
                        <tr key={`${m.fecha_hora}-${m.id_producto}-${i}`}>
                          <td>{fmtFechaHora(m.fecha_hora)}</td>
                          <td><span className={m.tipo === "venta" ? "badge accent" : "badge neutral"}>{m.tipo === "venta" ? "Venta" : "Compra"}</span></td>
                          <td>{m.producto}</td>
                          <td className="mono">{fmtCant(m.cantidad, m.unidad ?? "kg")}</td>
                          <td className="mono">{fmtCLP(m.monto_clp)}</td>
                          <td>{m.proveedor ?? "—"}</td>
                          <td>{m.usuario}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
              </>
            )}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
