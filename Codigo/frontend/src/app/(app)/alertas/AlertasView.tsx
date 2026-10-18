"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ErrorState, Loading } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cls } from "@/lib/cls";
import { fmtCant, fmtFecha, fmtFechaHora, NIVEL_BADGE, NIVEL_LABEL } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import styles from "../dashboard/page.module.css";

const c = cls(styles);

type Estado = "activa" | "atendida" | "descartada";

interface Alerta {
  id_alerta: number;
  producto: string;
  categoria: string;
  unidad: "kg" | "un";
  proveedor: string;
  nivel: "quiebre" | "bajo";
  estado: Estado;
  stock_actual: number;
  demanda_proyectada: number;
  cantidad_sugerida: number;
  lead_time_dias: number;
  fecha_limite_pedido: string;
  creada_en: string;
  resuelta_en: string | null;
  reemplazada: boolean;
  causa: string;
  causa_texto: string;
}

interface Respuesta {
  resumen: Record<Estado, number>;
  alertas: Alerta[];
}

const ESTADO_LABEL: Record<Estado, string> = { activa: "Activa", atendida: "Atendida", descartada: "Descartada" };
const ESTADO_BADGE: Record<Estado, string> = { activa: "badge quiebre", atendida: "badge saludable", descartada: "badge neutral" };

const FILTROS_ESTADO: [Estado | "", string][] = [
  ["", "Todas"],
  ["activa", "Activas"],
  ["atendida", "Atendidas"],
  ["descartada", "Descartadas"],
];
const FILTROS_NIVEL: ["" | "quiebre" | "bajo", string][] = [
  ["", "Todos los niveles"],
  ["quiebre", "Quiebre"],
  ["bajo", "Bajo"],
];

export function AlertasView() {
  const [estado, setEstado] = useState<Estado | "">("");
  const [nivel, setNivel] = useState<"" | "quiebre" | "bajo">("");
  const [enCurso, setEnCurso] = useState<number | null>(null);
  const { data, error, loading, reload } = useApi<Respuesta>("/alertas", { estado, nivel });
  const { user } = useAuth();
  const toast = useToast();
  const puedeResolver = user?.rol === "administrador";

  async function resolver(a: Alerta, nuevo: "atendida" | "descartada") {
    setEnCurso(a.id_alerta);
    try {
      await api.patch(`/alertas/${a.id_alerta}`, { estado: nuevo });
      toast.ok(`Alerta de ${a.producto} marcada como ${ESTADO_LABEL[nuevo].toLowerCase()}`);
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setEnCurso(null);
    }
  }

  return (
    <AppShell active="alertas">
      <div className={c("topbar")}>
        <div>
          <h1 className={c("h1")}>Historial de alertas</h1>
          <div className={c("subtitle")}>Productos que entraron en quiebre o stock bajo, con la causa y la sugerencia de ese momento</div>
        </div>
      </div>

      {data ? (
        <div className={c("grid4")} style={{ marginBottom: 16 }}>
          {(["activa", "atendida", "descartada"] as Estado[]).map((e) => (
            <div className={c("card stat")} key={e}>
              <div className={c("lbl")}>Alertas {ESTADO_LABEL[e].toLowerCase()}s</div>
              <div className={c("val")} style={e === "activa" && data.resumen.activa > 0 ? { color: "var(--quiebre)" } : undefined}>
                {data.resumen[e]}
              </div>
              <div className={c("delta")}>
                {e === "activa" ? "Pendientes de reposición" : e === "atendida" ? "Stock repuesto o atendidas a mano" : "Descartadas o reemplazadas por otro nivel"}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className={c("card")}>
        <div className="chips" style={{ marginBottom: 8 }}>
          {FILTROS_ESTADO.map(([v, txt]) => (
            <button key={v || "todas"} type="button" className={`chip${estado === v ? " on" : ""}`} onClick={() => setEstado(v)}>
              {txt}
            </button>
          ))}
        </div>
        <div className="chips" style={{ marginBottom: 14 }}>
          {FILTROS_NIVEL.map(([v, txt]) => (
            <button key={v || "todos"} type="button" className={`chip${nivel === v ? " on" : ""}`} onClick={() => setNivel(v)}>
              {txt}
            </button>
          ))}
        </div>

        {!data && loading ? <Loading texto="Cargando alertas…" /> : null}
        {!data && error ? <ErrorState message={error} onRetry={() => void reload()} /> : null}
        {data && data.alertas.length === 0 ? (
          <div className={c("vacio")}>No hay alertas con estos filtros.</div>
        ) : null}
        {data && data.alertas.length > 0 ? (
          <div className={c("scroll")}>
            <table className={c("tbl")}>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Producto</th>
                  <th scope="col">Nivel</th>
                  <th scope="col">Causa</th>
                  <th scope="col">Stock</th>
                  <th scope="col">Demanda hasta la entrega</th>
                  <th scope="col">Cantidad sugerida</th>
                  <th scope="col">Pedir hasta</th>
                  <th scope="col">Estado</th>
                  {puedeResolver ? <th scope="col">Acciones</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.alertas.map((a) => (
                  <tr key={a.id_alerta}>
                    <td className={c("mono")}>{fmtFechaHora(a.creada_en)}</td>
                    <td>
                      <span className={c("plink")}>{a.producto}</span>
                      <div className={c("hint")}>{a.categoria} · {a.proveedor}</div>
                    </td>
                    <td>
                      <span className={NIVEL_BADGE[a.nivel]}>{NIVEL_LABEL[a.nivel]}</span>
                    </td>
                    <td style={{ maxWidth: 260 }}>{a.causa_texto}</td>
                    <td className={c("mono")}>{fmtCant(a.stock_actual, a.unidad)}</td>
                    <td className={c("mono")}>
                      {fmtCant(a.demanda_proyectada, a.unidad)}
                      <div className={c("hint")}>lead time {a.lead_time_dias} d + 1</div>
                    </td>
                    <td className={c("mono")}>{fmtCant(a.cantidad_sugerida, a.unidad)}</td>
                    <td>{fmtFecha(a.fecha_limite_pedido)}</td>
                    <td>
                      <span className={ESTADO_BADGE[a.estado]}>{a.reemplazada ? "Cambió de nivel" : ESTADO_LABEL[a.estado]}</span>
                      {a.resuelta_en ? <div className={c("hint")}>{fmtFechaHora(a.resuelta_en)}</div> : null}
                    </td>
                    {puedeResolver ? (
                      <td>
                        {a.estado === "activa" ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button type="button" className="btn sm ghost" disabled={enCurso === a.id_alerta} onClick={() => void resolver(a, "atendida")}>
                              Atender
                            </button>
                            <button type="button" className="btn sm ghost" disabled={enCurso === a.id_alerta} onClick={() => void resolver(a, "descartada")}>
                              Descartar
                            </button>
                          </div>
                        ) : (
                          <span className={c("hint")}>—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
