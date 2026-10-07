"use client";

import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { cls } from "@/lib/cls";
import { fmtCant, fmtCLP, fmtFechaCorta, hoyISO, NIVEL_BADGE, NIVEL_LABEL } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import styles from "./page.module.css";
import { TendenciaChart, type PuntoTendencia } from "./TendenciaChart";

const c = cls(styles);

interface Sugerencia {
  id_producto: number;
  producto: string;
  categoria: string;
  unidad: "kg" | "un";
  nivel: "quiebre" | "bajo";
  stock_actual: number;
  stock_minimo: number;
  demanda_semana: number;
  dias_cobertura: number | null;
  proveedor: string;
  lead_time_dias: number;
  cantidad_sugerida: number;
  fecha_quiebre_estimada: string;
  fecha_limite_pedido: string;
}

interface Dashboard {
  generado_en: string;
  kpis: {
    valor_inventario_clp: number;
    productos_quiebre: number;
    productos_bajo: number;
    productos_optimo: number;
    total_productos: number;
    ventas_hoy_clp: number;
    tickets_hoy: number;
  };
  semaforo: { quiebre: number; bajo: number; optimo: number; total: number };
  tendencia: PuntoTendencia[];
  sugerencias: Sugerencia[];
  productos_criticos: Sugerencia[];
}

function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function fechaLimite(iso: string | null, hoy: string): { texto: string; vencida: boolean } {
  if (!iso) return { texto: "—", vencida: false };
  if (iso === hoy) return { texto: `Hoy, ${fmtFechaCorta(iso)}`, vencida: false };
  if (iso < hoy) return { texto: `Vencida · ${fmtFechaCorta(iso)}`, vencida: true };
  return { texto: fmtFechaCorta(iso), vencida: false };
}

function fechaHoraLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

function ventasHoyDetalle(k: Dashboard["kpis"]): string {
  if (k.tickets_hoy === 0) return "Sin ventas registradas hoy";
  return `${k.tickets_hoy} ${k.tickets_hoy === 1 ? "venta registrada" : "ventas registradas"}`;
}

export function DashboardView() {
  const { data, error, loading, obsoleto, sinConexion, reload } = useApi<Dashboard>("/dashboard", undefined, { resguardo: true });

  const hoy = hoyISO();
  const vacio = !!data && data.kpis.total_productos === 0;

  if (vacio) {
    return (
      <AppShell active="dashboard" mainClassName={c("mainx")}>
        <div className={c("topbar")} style={{ marginBottom: 0 }}>
          <div>
            <h1 className={c("h1")}>Dashboard</h1>
            <div className={c("subtitle")}>Resumen general</div>
          </div>
        </div>
        <div className={c("empty")}>
          <svg viewBox="0 0 100 100" width="64" height="64" opacity=".18" aria-hidden="true">
            <circle cx="50" cy="50" r="36" fill="none" stroke="var(--ink)" strokeWidth="3.5" />
            <circle cx="50" cy="12" r="3" fill="var(--accent)" />
            <circle cx="50" cy="88" r="3" fill="var(--accent)" />
            <text x="50" y="62" fontFamily="Bricolage Grotesque, sans-serif" fontWeight="700" fontSize="34" letterSpacing="-1" fill="var(--ink)" textAnchor="middle">
              NS
            </text>
          </svg>
          <div className={c("etitle")}>Aún no tienes productos registrados</div>
          <div className={c("esub")}>
            Todavía no hay productos en el inventario. Cuando existan productos y ventas registradas, aquí verás el semáforo de
            stock, la tendencia de ventas y las sugerencias de compra.
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="dashboard">
      <div className={c("topbar")}>
        <div>
          <h1 className={c("h1")}>Dashboard</h1>
          <div className={c("subtitle")}>
            Resumen general · hoy, {fechaLarga(hoy)}
            {data && obsoleto ? ` · Datos guardados el ${fechaHoraLocal(data.generado_en)}` : ""}
          </div>
        </div>
      </div>

      {!data && loading ? <Loading texto="Cargando el resumen…" /> : null}
      {!data && sinConexion ? (
        <EmptyState
          title="Aún no hay información guardada en este dispositivo"
          text="Estás sin conexión y todavía no tenemos un resguardo de tu resumen. Apenas vuelva la conexión lo cargaremos automáticamente."
        />
      ) : null}
      {!data && error ? <ErrorState message={error} onRetry={() => void reload()} /> : null}
      {data ? (
        <>
          {error ? (
            <div className="form-err" role="alert" style={{ marginTop: 0, marginBottom: 16 }}>
              No se pudo actualizar el resumen: {error}
            </div>
          ) : null}
          <div className={c("grid4")} style={{ marginBottom: "16px" }}>
            <div className={c("card stat")}>
              <div className={c("lbl")}>Valor de inventario</div>
              <div className={c("val")}>{fmtCLP(data.kpis.valor_inventario_clp)}</div>
              <div className={c("delta")}>A precio de venta · {data.kpis.total_productos} {data.kpis.total_productos === 1 ? "producto activo" : "productos activos"}</div>
            </div>
            <div className={c("card stat")}>
              <div className={c("lbl")}>Productos en quiebre</div>
              <div className={c("val")} style={{ color: data.kpis.productos_quiebre > 0 ? "var(--quiebre)" : undefined }}>
                {data.kpis.productos_quiebre}
              </div>
              <div className={c("delta")}>{data.kpis.productos_quiebre > 0 ? "Requiere compra urgente" : "Ningún producto en quiebre"}</div>
            </div>
            <div className={c("card stat")}>
              <div className={c("lbl")}>Productos con stock bajo</div>
              <div className={c("val")} style={{ color: data.kpis.productos_bajo > 0 ? "var(--alerta)" : undefined }}>
                {data.kpis.productos_bajo}
              </div>
              <div className={c("delta")}>{data.kpis.productos_bajo > 0 ? "Stock bajo lo que pide la demanda" : "Todo dentro de lo esperado"}</div>
            </div>
            <div className={c("card stat")}>
              <div className={c("lbl")}>Ventas hoy</div>
              <div className={c("val")}>{fmtCLP(data.kpis.ventas_hoy_clp)}</div>
              <div className={c("delta")}>{ventasHoyDetalle(data.kpis)}</div>
            </div>
          </div>

          <div className={c("row2")}>
            <div className={c("card tend")}>
              <div className={c("title")}>Tendencia de ventas: real vs. proyectada</div>
              <div className={c("legend")}>
                <span>
                  <i className={c("sw")} style={{ color: "var(--ink-muted)" }} />
                  Demanda real
                </span>
                <span>
                  <i className={c("sw dash")} style={{ color: "var(--accent)" }} />
                  Demanda proyectada (promedio histórico)
                </span>
                <span>Cantidad por semana · 8 semanas atrás + 2 por delante</span>
              </div>
              <TendenciaChart serie={data.tendencia} />
              <div className={c("hint")} style={{ marginTop: 6 }}>
                La semana en curso aún no termina, por eso su valor real puede quedar por debajo de lo proyectado.
              </div>
            </div>
            <div className={c("card semc")}>
              <div className={c("title")}>Semáforo de inventario</div>
              {([
                ["quiebre", "Quiebre", "Riesgo de quiebre de stock", "var(--quiebre)"],
                ["bajo", "Bajo", "Stock bajo lo esperado o bajo el mínimo", "var(--alerta)"],
                ["optimo", "Óptimo", "Stock suficiente", "var(--saludable)"],
              ] as const).map(([k, nombre, desc, color]) => (
                <div className={c("sem")} key={k}>
                  <div className={c("semleft")}>
                    <span className={c("semdot")} style={{ background: color }} />
                    <div>
                      <div style={{ fontSize: "13px" }}>{nombre}</div>
                      <div className={c("hint")}>{desc}</div>
                    </div>
                  </div>
                  <span className={c("mono")} style={{ fontSize: "18px", fontWeight: 600, color }}>
                    {data.semaforo[k]}
                  </span>
                </div>
              ))}
              <div className={c("stack")} role="img" aria-label={`${data.semaforo.quiebre} en quiebre, ${data.semaforo.bajo} bajos, ${data.semaforo.optimo} óptimos`}>
                <i style={{ width: `${(data.semaforo.quiebre / data.semaforo.total) * 100}%`, background: "var(--quiebre)" }} />
                <i style={{ width: `${(data.semaforo.bajo / data.semaforo.total) * 100}%`, background: "var(--alerta)" }} />
                <i style={{ width: `${(data.semaforo.optimo / data.semaforo.total) * 100}%`, background: "var(--saludable)" }} />
              </div>
              <div className={c("hint")}>
                {data.semaforo.total} {data.semaforo.total === 1 ? "producto" : "productos"} en total
              </div>
            </div>
          </div>

          <div className={c("card")} style={{ marginBottom: 16 }}>
            <div className={c("title")}>Sugerencias de compra</div>
            {data.sugerencias.length === 0 ? (
              <div className={c("vacio")}>No hay sugerencias de compra pendientes: el stock está acorde con la demanda proyectada.</div>
            ) : (
              <div className={c("scroll")}>
                <table className={c("tbl")}>
                  <thead>
                    <tr>
                      <th scope="col">Producto</th>
                      <th scope="col">Nivel</th>
                      <th scope="col">Stock actual</th>
                      <th scope="col">Cantidad sugerida</th>
                      <th scope="col">Proveedor</th>
                      <th scope="col">Fecha límite para pedir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sugerencias.map((a) => {
                      const lim = fechaLimite(a.fecha_limite_pedido, hoy);
                      return (
                        <tr key={a.id_producto}>
                          <td>
                            <span className={c("plink")}>{a.producto}</span>
                          </td>
                          <td>
                            <span className={NIVEL_BADGE[a.nivel]}>{NIVEL_LABEL[a.nivel]}</span>
                          </td>
                          <td className={c("mono")}>{fmtCant(a.stock_actual, a.unidad)}</td>
                          <td className={c("mono")}>{fmtCant(a.cantidad_sugerida, a.unidad)}</td>
                          <td>{a.proveedor}</td>
                          <td style={lim.vencida ? { color: "var(--quiebre)" } : undefined}>{lim.texto}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={c("card")}>
            <div className={c("title")}>Productos críticos</div>
            {data.productos_criticos.length === 0 ? (
              <div className={c("vacio")}>Ningún producto en quiebre ni con stock bajo.</div>
            ) : (
              <div className={c("scroll")}>
                <table className={c("tbl")}>
                  <thead>
                    <tr>
                      <th scope="col">Producto</th>
                      <th scope="col">Nivel</th>
                      <th scope="col">Stock actual</th>
                      <th scope="col">Mínimo</th>
                      <th scope="col">Demanda semanal</th>
                      <th scope="col">Cobertura</th>
                      <th scope="col">Proveedor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.productos_criticos.map((p) => (
                      <tr key={p.id_producto}>
                        <td>
                          <span className={c("plink")}>{p.producto}</span>
                          <div className={c("hint")}>{p.categoria}</div>
                        </td>
                        <td>
                          <span className={NIVEL_BADGE[p.nivel]}>{NIVEL_LABEL[p.nivel]}</span>
                        </td>
                        <td className={c("mono")}>{fmtCant(p.stock_actual, p.unidad)}</td>
                        <td className={c("mono")}>{fmtCant(p.stock_minimo, p.unidad)}</td>
                        <td className={c("mono")}>{fmtCant(p.demanda_semana, p.unidad)}</td>
                        <td className={c("mono")}>{p.dias_cobertura === null ? "—" : `${p.dias_cobertura} ${p.dias_cobertura === 1 ? "día" : "días"}`}</td>
                        <td>{p.proveedor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}

    </AppShell>
  );
}
