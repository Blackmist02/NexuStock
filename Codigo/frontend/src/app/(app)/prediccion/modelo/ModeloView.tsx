"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { SubNav } from "@/components/SubNav";
import { Button } from "@/components/ui/Field";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ConfirmarModal } from "@/components/modales/ConfirmarModal";
import { ModeloModal } from "@/components/modales/ModeloModal";
import { useAuth } from "@/lib/auth";
import { ApiClientError, api, errorMessage } from "@/lib/api";
import { fmtFecha, fmtNum } from "@/lib/format";
import { puede } from "@/lib/permisos";
import { ORIGEN_LABEL, type Modelo, type OrigenDemanda, type Unidad } from "@/lib/tipos";
import { useApi } from "@/lib/useApi";
import { tabsPrediccion } from "../tabs";

interface Precision {
  activo: Modelo | null;
  modelos: Modelo[];
  motor: { disponible: boolean; limite_ms: number; latencia_promedio_ms: number | null; latencia_maxima_ms: number | null; predicciones_con_modelo: number };
  base: { mae_general: number; mae_festivos: number | null; observaciones: number; ventana: { desde: string; hasta: string; tipo: "prueba" | "reciente" } } | null;
  mejora_general_pct: number | null;
  productos: { id_producto: number; producto: string; unidad: Unidad; origen: OrigenDemanda; mae_respaldo: number | null; sin_historial: boolean }[];
}

export function ModeloView() {
  const { user } = useAuth();
  const toast = useToast();
  const permitido = puede(user?.rol, "modelo");
  const { data, error, loading, reload } = useApi<{ data: Precision }>(permitido ? "/models" : null);
  const [registrar, setRegistrar] = useState(false);
  const [activar, setActivar] = useState<{ m: Modelo; confirmarMenor: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [errAccion, setErrAccion] = useState<string | null>(null);
  const gestiona = puede(user?.rol, "registrar_modelo");
  const d = data?.data;

  async function activarModelo(m: Modelo, confirmar: boolean) {
    setOcupado(true);
    setErrAccion(null);
    try {
      await api.patch(`/models/${m.id_modelo}/activar`, { confirmar });
      toast.ok(`Modelo ${m.algoritmo} ${m.version} activado`);
      setActivar(null);
      void reload();
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "requiere_confirmacion") setActivar({ m, confirmarMenor: true });
      setErrAccion(errorMessage(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <AppShell active="prediccion">
      <div className="topbar">
        <div>
          <h1 className="h1">Precisión del modelo</h1>
          <div className="subtitle">Qué tan cerca está la proyección de las ventas reales (error medio absoluto, en kg)</div>
        </div>
        <div className="topbar-right">{gestiona ? <Button size="sm" variant="primary" onClick={() => setRegistrar(true)}>Registrar versión</Button> : null}</div>
      </div>
      <SubNav items={tabsPrediccion(user?.rol)} activa="/prediccion/modelo" />

      {!permitido ? <EmptyState title="No tienes acceso a esta sección" text="La precisión del modelo la ven los roles Administrador y TI." /> : null}
      {permitido && !d && loading ? <Loading /> : null}
      {permitido && !d && error ? <ErrorState message={error} onRetry={() => void reload()} /> : null}

      {d ? (
        <>
          <div className="grid4">
            <div className="card stat">
              <div className="lbl">Modelo activo</div>
              <div className="val" style={{ fontSize: 18 }}>{d.activo ? `${d.activo.algoritmo} ${d.activo.version}` : "Ninguno"}</div>
              <div className="sub">{d.activo ? `Entrenado hasta ${fmtFecha(d.activo.entrenado_hasta)}` : "Se usa el promedio histórico"}</div>
            </div>
            <div className="card stat">
              <div className="lbl">MAE general</div>
              <div className="val">{d.activo ? `${fmtNum(d.activo.mae_general, 2)} kg` : "—"}</div>
              <div className="sub">{d.mejora_general_pct != null ? `${Math.abs(d.mejora_general_pct)} % ${d.mejora_general_pct >= 0 ? "mejor" : "peor"} que el promedio histórico` : "Sin comparación disponible"}</div>
            </div>
            <div className="card stat">
              <div className="lbl">MAE en festivos</div>
              <div className="val">{d.activo?.mae_festivos != null ? `${fmtNum(d.activo.mae_festivos, 2)} kg` : "—"}</div>
              <div className="sub">{d.base?.mae_festivos != null ? `Promedio histórico: ${fmtNum(d.base.mae_festivos, 2)} kg` : "Fechas de mayor demanda"}</div>
            </div>
            <div className="card stat">
              <div className="lbl">Motor de predicción</div>
              <div className="val" style={{ fontSize: 18 }}><span className={d.motor.disponible ? "pill" : "pill warn"}>{d.motor.disponible ? "Disponible" : "Con respaldo"}</span></div>
              <div className="sub">
                {d.motor.latencia_promedio_ms != null ? `Respuesta media ${fmtNum(d.motor.latencia_promedio_ms, 0)} ms (límite ${d.motor.limite_ms} ms)` : `Límite de respuesta ${d.motor.limite_ms} ms`}
              </div>
            </div>
          </div>

          {d.base ? (
            <div className="callout info sticky-aviso">
              <span>
                Línea base del respaldo (promedio histórico): MAE <b>{fmtNum(d.base.mae_general, 2)} kg</b> sobre {d.base.observaciones} observaciones,{" "}
                {d.base.ventana.tipo === "prueba" ? "en la ventana de prueba del modelo" : "en las últimas 8 semanas"} ({fmtFecha(d.base.ventana.desde)} a {fmtFecha(d.base.ventana.hasta)}).
              </span>
            </div>
          ) : null}

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="title">Versiones registradas</div>
            {d.modelos.length === 0 ? (
              <EmptyState title="Aún no hay versiones del modelo" text="Mientras tanto, la proyección usa el promedio histórico de cada producto." />
            ) : (
              <div className="scrollx">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th scope="col">Modelo</th>
                      <th scope="col">MAE general</th>
                      <th scope="col">MAE festivos</th>
                      <th scope="col">Entrenamiento</th>
                      <th scope="col">Prueba</th>
                      <th scope="col">Estado</th>
                      {gestiona ? <th scope="col"><span className="sr-only">Acciones</span></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {d.modelos.map((m) => (
                      <tr key={m.id_modelo}>
                        <td>{m.algoritmo} {m.version}<div className="mini">{m.artefacto_ruta}</div></td>
                        <td className="mono">{fmtNum(m.mae_general, 2)} kg</td>
                        <td className="mono">{m.mae_festivos == null ? "—" : `${fmtNum(m.mae_festivos, 2)} kg`}</td>
                        <td>{fmtFecha(m.entrenado_desde)} – {fmtFecha(m.entrenado_hasta)}</td>
                        <td>{fmtFecha(m.prueba_desde)} – {fmtFecha(m.prueba_hasta)}</td>
                        <td><span className={m.activo ? "badge saludable" : "badge neutral"}>{m.activo ? "Activo" : "Inactivo"}</span></td>
                        {gestiona ? (
                          <td><div className="row-actions">{!m.activo ? <Button size="sm" onClick={() => { setErrAccion(null); setActivar({ m, confirmarMenor: !!d.activo && m.mae_general > d.activo.mae_general }); }}>Activar</Button> : null}</div></td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="title">Origen de la proyección por producto</div>
            <div className="scrollx">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Producto</th>
                    <th scope="col">Origen</th>
                    <th scope="col">MAE del respaldo (8 semanas)</th>
                  </tr>
                </thead>
                <tbody>
                  {d.productos.map((p) => (
                    <tr key={p.id_producto}>
                      <td>{p.producto}</td>
                      <td><span className={p.origen === "modelo" ? "badge accent" : "badge neutral"}>{ORIGEN_LABEL[p.origen]}</span>{p.sin_historial ? <div className="mini">Producto sin historial de ventas</div> : null}</td>
                      <td className="mono">{p.mae_respaldo == null ? "—" : `${fmtNum(p.mae_respaldo, 2)} ${p.unidad}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {registrar ? <ModeloModal onClose={() => setRegistrar(false)} onHecho={() => { setRegistrar(false); void reload(); }} /> : null}
      {activar ? (
        <ConfirmarModal
          titulo="Activar versión del modelo"
          confirmar={activar.confirmarMenor ? "Activar de todos modos" : "Activar"}
          ocupado={ocupado}
          error={errAccion}
          onClose={() => setActivar(null)}
          onConfirmar={() => void activarModelo(activar.m, activar.confirmarMenor)}
        >
          {activar.confirmarMenor
            ? `El MAE de ${activar.m.algoritmo} ${activar.m.version} (${fmtNum(activar.m.mae_general, 2)} kg) no mejora al del modelo activo. ¿Quieres activarlo de todos modos?`
            : `${activar.m.algoritmo} ${activar.m.version} pasará a ser el modelo activo y se desactivará el actual. Las proyecciones se recalcularán con la próxima evaluación.`}
        </ConfirmarModal>
      ) : null}
    </AppShell>
  );
}
