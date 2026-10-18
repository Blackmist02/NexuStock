"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { SubNav } from "@/components/SubNav";
import { LineaDemanda, type PuntoDia } from "@/components/charts/LineaDemanda";
import { Button } from "@/components/ui/Field";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/lib/auth";
import { api, errorMessage } from "@/lib/api";
import { fmtCant, fmtFecha, fmtFechaCorta, NIVEL_BADGE, NIVEL_LABEL, type Nivel } from "@/lib/format";
import { puede } from "@/lib/permisos";
import { ORIGEN_LABEL, type Alerta, type Categoria, type Evento, type OrigenDemanda, type Unidad } from "@/lib/tipos";
import { useApi } from "@/lib/useApi";
import { tabsPrediccion } from "./tabs";

interface Resumen {
  hoy: string;
  motor: { estado: "modelo" | "respaldo"; modelo: { algoritmo: string; version: string } | null; motivo: string | null };
  productos: {
    id_producto: number;
    producto: string;
    categoria: string;
    unidad: Unidad;
    nivel: Nivel;
    demanda_7d: number;
    origen_demanda: OrigenDemanda;
    stock_actual: number;
    cantidad_sugerida: number | null;
    proveedor: string;
    fecha_limite_pedido: string | null;
  }[];
}

interface Serie {
  producto: string;
  unidad: Unidad;
  hoy: string;
  historico: PuntoDia[];
  prediccion: PuntoDia[];
  eventos: Evento[];
}

export function PrediccionView() {
  const { user } = useAuth();
  const toast = useToast();
  const [categoria, setCategoria] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cats = useApi<{ data: Categoria[] }>("/categories");
  const res = useApi<Resumen>("/predictions/resumen", { categoria }, { resguardo: true });
  const alertas = useApi<{ data: Alerta[] }>("/alerts", { estado: "activa" }, { resguardo: true });

  const productos = res.data?.productos ?? [];
  const idSerie = sel ?? productos[0]?.id_producto ?? null;
  const serie = useApi<{ data: Serie }>(idSerie ? `/predictions/producto/${idSerie}/serie` : null, { dias: 30 });

  const puedeAlertas = puede(user?.rol, "alertas");

  async function resolver(a: Alerta, estado: "atendida" | "descartada") {
    setOcupado(`a${a.id_alerta}`);
    try {
      await api.patch(`/alerts/${a.id_alerta}`, { estado });
      toast.ok(estado === "atendida" ? "Alerta marcada como atendida" : "Alerta descartada");
      void alertas.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setOcupado(null);
    }
  }

  async function recalcular() {
    setOcupado("recalcular");
    try {
      const r = await api.post<{ data: { evaluados: number; creadas: number; cerradas: number } }>("/alerts/evaluate");
      toast.ok(`Predicciones recalculadas (${r.data.evaluados} productos, ${r.data.creadas} alertas nuevas, ${r.data.cerradas} cerradas).`);
      void res.reload();
      void alertas.reload();
      void serie.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <AppShell active="prediccion">
      <div className="topbar">
        <div>
          <h1 className="h1">Predicción de demanda y alertas</h1>
          <div className="subtitle">Demanda proyectada a 7 días, cuánto pedir y hasta cuándo</div>
        </div>
        <div className="topbar-right">
          <select className="input surface" style={{ height: 32, width: "auto" }} aria-label="Categoría" value={categoria} onChange={(e) => { setCategoria(e.target.value); setSel(null); }}>
            <option value="">Todas las categorías</option>
            {(cats.data?.data ?? []).map((c) => <option key={c.id_categoria} value={c.id_categoria}>{c.nombre}</option>)}
          </select>
          {puede(user?.rol, "recalcular") ? <Button size="sm" variant="primary" loading={ocupado === "recalcular"} onClick={() => void recalcular()}>Recalcular</Button> : null}
        </div>
      </div>
      <SubNav items={tabsPrediccion(user?.rol)} activa="/prediccion" />

      {res.data?.motor.estado === "respaldo" ? (
        <div className="callout sticky-aviso" role="status">
          <span><b>Estimación con promedio histórico.</b> {res.data.motor.motivo} Las alertas siguen funcionando con esa estimación.</span>
        </div>
      ) : res.data?.motor.modelo ? (
        <div className="callout ok sticky-aviso" role="status">
          <span>Proyección con el modelo <b>{res.data.motor.modelo.algoritmo} {res.data.motor.modelo.version}</b>. Si no responde a tiempo se usa el promedio histórico.</span>
        </div>
      ) : null}

      {!res.data && res.loading ? <Loading texto="Calculando la demanda…" /> : null}
      {!res.data && res.error ? <ErrorState message={res.error} onRetry={() => void res.reload()} /> : null}
      {res.data && productos.length === 0 ? <EmptyState title="No hay productos para proyectar" text="Crea productos y registra ventas para ver la demanda estimada." /> : null}

      {res.data && productos.length > 0 ? (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="title">
              Demanda diaria
              <select className="input surface" style={{ height: 30, width: "auto", maxWidth: 260 }} aria-label="Producto" value={idSerie ?? ""} onChange={(e) => setSel(Number(e.target.value))}>
                {productos.map((p) => <option key={p.id_producto} value={p.id_producto}>{p.producto}</option>)}
              </select>
            </div>
            <div className="legend">
              <span style={{ color: "var(--ink-muted)" }}><i />Ventas reales</span>
              <span style={{ color: "var(--accent)" }}><i className="dash" />Proyección 7 días</span>
              <span>Feriados y eventos marcados en el gráfico</span>
            </div>
            {!serie.data && serie.loading ? <Loading /> : null}
            {!serie.data && serie.error ? <ErrorState message={serie.error} onRetry={() => void serie.reload()} /> : null}
            {serie.data ? (
              <LineaDemanda historico={serie.data.data.historico} prediccion={serie.data.data.prediccion} eventos={serie.data.data.eventos} unidad={serie.data.data.unidad} hoy={serie.data.data.hoy} />
            ) : null}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="title">Proyección por producto</div>
            <div className="scrollx">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Producto</th>
                    <th scope="col">Nivel</th>
                    <th scope="col">Demanda 7 días</th>
                    <th scope="col">Stock</th>
                    <th scope="col">Sugerido</th>
                    <th scope="col">Proveedor</th>
                    <th scope="col">Pedir antes del</th>
                    <th scope="col">Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {productos.map((p) => (
                    <tr key={p.id_producto}>
                      <td><Link className="heading-link" href={`/inventario/${p.id_producto}`}>{p.producto}</Link><div className="mini">{p.categoria}</div></td>
                      <td><span className={NIVEL_BADGE[p.nivel]}>{NIVEL_LABEL[p.nivel]}</span></td>
                      <td className="mono">{fmtCant(p.demanda_7d, p.unidad)}</td>
                      <td className="mono">{fmtCant(p.stock_actual, p.unidad)}</td>
                      <td className="mono">{p.cantidad_sugerida == null ? "—" : fmtCant(p.cantidad_sugerida, p.unidad)}</td>
                      <td>{p.proveedor}</td>
                      <td style={p.fecha_limite_pedido && p.fecha_limite_pedido < res.data!.hoy ? { color: "var(--quiebre)" } : undefined}>
                        {p.fecha_limite_pedido ? fmtFechaCorta(p.fecha_limite_pedido) : "—"}
                      </td>
                      <td><span className={p.origen_demanda === "modelo" ? "badge accent" : "badge neutral"}>{ORIGEN_LABEL[p.origen_demanda]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      <div className="card">
        <div className="title">Alertas activas</div>
        {!alertas.data && alertas.loading ? <Loading /> : null}
        {!alertas.data && alertas.error ? <ErrorState message={alertas.error} onRetry={() => void alertas.reload()} /> : null}
        {alertas.data && alertas.data.data.length === 0 ? <EmptyState title="Sin alertas activas" text="Cuando un producto pase a Bajo o Quiebre aparecerá aquí con la cantidad a pedir y la fecha límite." /> : null}
        {alertas.data && alertas.data.data.length > 0 ? (
          <div className="scrollx">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col">Nivel</th>
                  <th scope="col">Stock</th>
                  <th scope="col">Sugerido</th>
                  <th scope="col">Se agota</th>
                  <th scope="col">Pedir antes del</th>
                  <th scope="col">Proveedor</th>
                  {puedeAlertas ? <th scope="col"><span className="sr-only">Acciones</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {alertas.data.data.map((a) => (
                  <tr key={a.id_alerta}>
                    <td><Link className="heading-link" href={`/inventario/${a.id_producto}`}>{a.producto}</Link></td>
                    <td><span className={NIVEL_BADGE[a.nivel]}>{NIVEL_LABEL[a.nivel]}</span></td>
                    <td className="mono">{fmtCant(a.stock_actual, a.unidad)}</td>
                    <td className="mono">{fmtCant(a.cantidad_sugerida, a.unidad)}</td>
                    <td>{fmtFecha(a.fecha_quiebre_estimada)}</td>
                    <td style={res.data && a.fecha_limite_pedido < res.data.hoy ? { color: "var(--quiebre)" } : undefined}>{fmtFecha(a.fecha_limite_pedido)}</td>
                    <td>{a.proveedor}<div className="mini">lead time {a.lead_time_dias} d</div></td>
                    {puedeAlertas ? (
                      <td>
                        <div className="row-actions">
                          <Button size="sm" variant="primary" loading={ocupado === `a${a.id_alerta}`} onClick={() => void resolver(a, "atendida")}>Atender</Button>
                          <Button size="sm" disabled={ocupado === `a${a.id_alerta}`} onClick={() => void resolver(a, "descartada")}>Descartar</Button>
                        </div>
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
