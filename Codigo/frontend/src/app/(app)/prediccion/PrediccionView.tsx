"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { SubNav } from "@/components/SubNav";
import { GraficoDemanda, type DiaSerie, type SemanaSerie } from "@/components/charts/GraficoDemanda";
import { Button } from "@/components/ui/Field";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/lib/auth";
import { api, errorMessage } from "@/lib/api";
import { fmtCant, fmtFecha, fmtFechaCorta, fmtNum, NIVEL_BADGE, NIVEL_LABEL, type Nivel } from "@/lib/format";
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
  desde: string;
  hasta: string;
  productos: number;
  origen_proyeccion: OrigenDemanda | "mixto";
  latencia_ms: number | null;
  mae_modelo_semana: number | null;
  precision_periodo: { semanas: number; mae_semana: number } | null;
  dias: DiaSerie[];
  semanas: SemanaSerie[];
  eventos: Evento[];
}

const OPCIONES_MESES = [1, 2, 3, 4];
const mesesTxt = (n: number) => `${n} ${n === 1 ? "mes" : "meses"}`;

export function PrediccionView() {
  const { user } = useAuth();
  const toast = useToast();
  const [categoria, setCategoria] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [atras, setAtras] = useState(1);
  const [adelante, setAdelante] = useState(1);

  const cats = useApi<{ data: Categoria[] }>("/categories");
  const res = useApi<Resumen>("/predictions/resumen", { categoria }, { resguardo: true });
  const alertas = useApi<{ data: Alerta[] }>("/alerts", { estado: "activa" }, { resguardo: true });

  const productos = res.data?.productos ?? [];
  // Sin producto elegido se muestra el total (de todos los productos o de la categoría filtrada)
  const idSerie = sel != null && productos.some((p) => p.id_producto === sel) ? sel : null;
  const nombreCategoria = (cats.data?.data ?? []).find((c) => String(c.id_categoria) === categoria)?.nombre;
  const serie = useApi<{ data: Serie }>(
    idSerie ? `/predictions/producto/${idSerie}/serie` : "/predictions/serie",
    idSerie ? { atras, adelante } : { atras, adelante, categoria },
  );
  const sd = serie.data?.data;

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
            <div className="title" style={{ flexWrap: "wrap", gap: 8 }}>
              Demanda real y proyectada
              <div className="row-actions" style={{ flexWrap: "wrap", alignItems: "center" }}>
                <select className="input surface" style={{ height: 30, width: "auto", maxWidth: 260 }} aria-label="Producto" value={idSerie ?? ""} onChange={(e) => setSel(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{nombreCategoria ? `Toda la categoría ${nombreCategoria} (total)` : "Todos los productos (total)"}</option>
                  {productos.map((p) => <option key={p.id_producto} value={p.id_producto}>{p.producto}</option>)}
                </select>
                <label className="hint" htmlFor="pr-atras">Hacia atrás</label>
                <select id="pr-atras" className="input surface" style={{ height: 30, width: "auto" }} value={atras} onChange={(e) => setAtras(Number(e.target.value))}>
                  {OPCIONES_MESES.map((m) => <option key={m} value={m}>{mesesTxt(m)}</option>)}
                </select>
                <label className="hint" htmlFor="pr-adelante">Hacia adelante</label>
                <select id="pr-adelante" className="input surface" style={{ height: 30, width: "auto" }} value={adelante} onChange={(e) => setAdelante(Number(e.target.value))}>
                  {OPCIONES_MESES.map((m) => <option key={m} value={m}>{mesesTxt(m)}</option>)}
                </select>
              </div>
            </div>
            <div className="legend">
              <span style={{ color: "var(--ink-muted)" }}><i />Venta real</span>
              <span style={{ color: "var(--accent)", opacity: 0.6 }}><i className="dash" />Predicción registrada (semanas pasadas)</span>
              <span style={{ color: "var(--accent)" }}><i className="dash" />Proyección desde esta semana</span>
              <span style={{ color: "var(--alerta)" }}>★ Feriados y eventos</span>
            </div>
            {!serie.data && serie.loading ? <Loading texto="Proyectando la demanda…" /> : null}
            {!serie.data && serie.error ? <ErrorState message={serie.error} onRetry={() => void serie.reload()} /> : null}
            {sd ? (
              <>
                {sd.origen_proyeccion === "mixto" ? (
                  <div className="callout" role="status" style={{ marginBottom: 10 }}>
                    <span>Algunos productos no se pudieron proyectar con el modelo (por ejemplo, sin historial): para ellos se repite su demanda semanal vigente.</span>
                  </div>
                ) : sd.origen_proyeccion !== "modelo" ? (
                  <div className="callout" role="status" style={{ marginBottom: 10 }}>
                    <span>La proyección usa el <b>{ORIGEN_LABEL[sd.origen_proyeccion].toLowerCase()}</b> porque el modelo no está disponible: se repite la demanda semanal vigente.</span>
                  </div>
                ) : null}
                {!idSerie ? (
                  <div className="hint" style={{ marginBottom: 6 }}>
                    Suma de {sd.productos} {sd.productos === 1 ? "producto" : "productos"} por kilo{nombreCategoria ? ` de ${nombreCategoria}` : ""}. Elige un producto para ver su detalle.
                  </div>
                ) : null}
                <GraficoDemanda dias={sd.dias} semanas={sd.semanas} eventos={sd.eventos} unidad={sd.unidad} hoy={sd.hoy} />
                <div className="gd-resumen">
                  {sd.precision_periodo ? (
                    <>
                      En las <b>{sd.precision_periodo.semanas}</b> semanas pasadas del periodo, la predicción registrada se equivocó en promedio{" "}
                      <b>{fmtNum(sd.precision_periodo.mae_semana)} {sd.unidad} por semana</b>
                      {sd.mae_modelo_semana != null && idSerie ? <> (MAE por producto del modelo en la prueba 2024: {fmtNum(sd.mae_modelo_semana, 2)} kg)</> : null}.{" "}
                    </>
                  ) : (
                    <>Aún no hay predicciones registradas para las semanas pasadas de este periodo. </>
                  )}
                  La proyección semanal se reparte entre los días según cuánto vende cada día de la semana.
                  {sd.latencia_ms != null ? <> Calculada en {sd.latencia_ms} ms.</> : null}
                </div>
              </>
            ) : null}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="title">Cómo se calcula la sugerencia de compra</div>
            <ul className="regla-lista">
              <li><b>Demanda hasta el pedido siguiente:</b> la proyección de la semana, repartida por día, desde hoy hasta que llega el pedido siguiente al proveedor (según sus días de atención y su lead time), sin superar lo que se alcanza a vender antes de que venza el producto.</li>
              <li><b>Semáforo:</b> <span className={NIVEL_BADGE.quiebre}>Quiebre</span> si el stock no alcanza esa demanda; <span className={NIVEL_BADGE.bajo}>Bajo</span> si no alcanza la demanda más el margen de seguridad o está bajo el stock mínimo; <span className={NIVEL_BADGE.optimo}>Óptimo</span> en otro caso.</li>
              <li><b>Cantidad sugerida:</b> demanda × (1 + margen) − stock, sin superar lo que se alcanza a vender antes de que venza el producto.</li>
              <li><b>Pedir antes del:</b> fecha estimada de quiebre menos el lead time; si cae en un día sin atención del proveedor, se adelanta al día hábil anterior.</li>
            </ul>
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
