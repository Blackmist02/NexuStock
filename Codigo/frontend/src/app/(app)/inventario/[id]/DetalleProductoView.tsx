"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BarrasMovimientos } from "@/components/charts/BarrasMovimientos";
import { Button } from "@/components/ui/Field";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ConfirmarModal } from "@/components/modales/ConfirmarModal";
import { MovimientoModal } from "@/components/modales/MovimientoModal";
import { ProductoModal } from "@/components/modales/ProductoModal";
import { useAuth } from "@/lib/auth";
import { ApiClientError, api, errorMessage } from "@/lib/api";
import { fmtCant, fmtCLP, fmtFecha, fmtFechaHora, fmtNum, hoyISO, NIVEL_BADGE, NIVEL_LABEL } from "@/lib/format";
import { puede } from "@/lib/permisos";
import { ORIGEN_LABEL, type DetalleProducto } from "@/lib/tipos";
import { useApi } from "@/lib/useApi";

export function DetalleProductoView({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const { data: p, error, loading, reload } = useApi<{ data: DetalleProducto }>(`/products/${encodeURIComponent(id)}`);
  const [modal, setModal] = useState<null | "venta" | "compra" | "editar" | "estado" | "eliminar">(null);
  const [ocupado, setOcupado] = useState(false);
  const [errAccion, setErrAccion] = useState<string | null>(null);
  const prod = p?.data;
  const hoy = hoyISO();

  function cerrar() {
    setModal(null);
    setErrAccion(null);
  }

  async function cambiarEstado() {
    if (!prod) return;
    setOcupado(true);
    try {
      await api.patch(`/products/${prod.id_producto}/estado`, { activo: !prod.activo });
      toast.ok(prod.activo ? "Producto desactivado" : "Producto reactivado");
      cerrar();
      void reload();
    } catch (e) {
      setErrAccion(errorMessage(e));
    } finally {
      setOcupado(false);
    }
  }

  async function eliminar() {
    if (!prod) return;
    setOcupado(true);
    try {
      await api.delete(`/products/${prod.id_producto}`);
      toast.ok("Producto eliminado");
      router.replace("/inventario");
    } catch (e) {
      setErrAccion(e instanceof ApiClientError ? e.message : errorMessage(e));
      setOcupado(false);
    }
  }

  return (
    <AppShell active="inventario">
      <div className="crumb"><Link href="/inventario" className="link">Inventario</Link> / <b>{prod?.nombre ?? "Producto"}</b></div>
      {!prod && loading ? <Loading texto="Cargando el producto…" /> : null}
      {!prod && error ? (
        error.toLowerCase().includes("no existe") ? <EmptyState title="Este producto no existe" action={<Link href="/inventario" className="btn ghost sm" style={{ textDecoration: "none" }}>Volver al inventario</Link>} /> : <ErrorState message={error} onRetry={() => void reload()} />
      ) : null}
      {prod ? (
        <>
          <div className="topbar">
            <div>
              <h1 className="h1">{prod.nombre}</h1>
              <div className="subtitle">
                {prod.categoria} · {prod.proveedor} (lead time {prod.lead_time_dias} {prod.lead_time_dias === 1 ? "día" : "días"})
              </div>
            </div>
            <div className="topbar-right">
              {prod.activo && puede(user?.rol, "movimientos") ? (
                <>
                  <Button size="sm" onClick={() => setModal("compra")}>Registrar compra</Button>
                  <Button size="sm" variant="primary" onClick={() => setModal("venta")}>Registrar venta</Button>
                </>
              ) : null}
              {puede(user?.rol, "catalogo") ? (
                <>
                  <Button size="sm" onClick={() => setModal("editar")}>Editar</Button>
                  <Button size="sm" onClick={() => setModal("estado")}>{prod.activo ? "Desactivar" : "Reactivar"}</Button>
                  <Button size="sm" variant="danger" onClick={() => setModal("eliminar")}>Eliminar</Button>
                </>
              ) : null}
            </div>
          </div>

          {!prod.activo ? <div className="callout info sticky-aviso">Este producto está inactivo: no aparece en el Dashboard ni en las predicciones, y no admite ventas ni compras.</div> : null}
          {prod.sugerencia ? (
            <div className="callout sticky-aviso" role="status">
              <span>
                <b>{prod.nivel === "quiebre" ? "En quiebre" : "Stock bajo"}.</b> Se estima que se agota el <b>{fmtFecha(prod.sugerencia.fecha_quiebre_estimada)}</b>. Para llegar a tiempo, pide{" "}
                <b>{fmtCant(prod.sugerencia.cantidad_sugerida, prod.unidad)}</b> a {prod.proveedor} a más tardar el{" "}
                <b style={prod.sugerencia.fecha_limite_pedido < hoy ? { color: "var(--quiebre)" } : undefined}>{fmtFecha(prod.sugerencia.fecha_limite_pedido)}</b>.
              </span>
            </div>
          ) : null}

          <div className="grid4">
            <div className="card stat">
              <div className="lbl">Stock actual</div>
              <div className="val">{fmtCant(prod.stock_actual, prod.unidad)}</div>
              <div className="sub">Mínimo {fmtCant(prod.stock_minimo, prod.unidad)}</div>
            </div>
            <div className="card stat">
              <div className="lbl">Estado</div>
              <div className="val" style={{ fontSize: 18 }}>{prod.nivel ? <span className={NIVEL_BADGE[prod.nivel]}>{NIVEL_LABEL[prod.nivel]}</span> : <span className="badge neutral">Inactivo</span>}</div>
              <div className="sub">{prod.dias_cobertura == null ? "Sin cobertura estimada" : `Cobertura ≈ ${prod.dias_cobertura} ${prod.dias_cobertura === 1 ? "día" : "días"}`}</div>
            </div>
            <div className="card stat">
              <div className="lbl">Demanda semanal</div>
              <div className="val">{prod.demanda_semana == null ? "—" : fmtCant(prod.demanda_semana, prod.unidad)}</div>
              <div className="sub">{prod.origen_demanda ? ORIGEN_LABEL[prod.origen_demanda] : "—"}</div>
            </div>
            <div className="card stat">
              <div className="lbl">Valor en stock</div>
              <div className="val">{fmtCLP(prod.valor_stock_clp)}</div>
              <div className="sub">Precio de venta {fmtCLP(prod.precio_venta_clp)}</div>
            </div>
          </div>

          <div className="pgrid c2">
            <div className="card">
              <div className="title">Compras y ventas · últimos 30 días</div>
              <div className="legend">
                <span style={{ color: "var(--accent-2)" }}><i className="sq" />Compras</span>
                <span style={{ color: "var(--accent)" }}><i className="sq" />Ventas</span>
              </div>
              <BarrasMovimientos serie={prod.serie_30d} unidad={prod.unidad} />
            </div>
            <div className="card">
              <div className="title">Ficha</div>
              <div className="kv"><span>Unidad</span><span>{prod.unidad === "kg" ? "Kilos" : "Unidades"}</span></div>
              <div className="kv"><span>Vida útil</span><span>{prod.vida_util_dias ? `${prod.vida_util_dias} días` : "No definida"}</span></div>
              <div className="kv"><span>Margen de seguridad</span><span>{fmtNum(prod.margen_seguridad_pct, 1)} %</span></div>
              <div className="kv"><span>Última compra</span><span>{fmtFechaHora(prod.ultima_compra)}</span></div>
              <div className="kv"><span>Última venta</span><span>{fmtFechaHora(prod.ultima_venta)}</span></div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="title">Últimos movimientos</div>
            {prod.movimientos.length === 0 ? (
              <EmptyState title="Sin movimientos todavía" text="Cuando registres ventas o compras de este producto aparecerán aquí." />
            ) : (
              <div className="scrollx">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th scope="col">Fecha y hora</th>
                      <th scope="col">Tipo</th>
                      <th scope="col">Cantidad</th>
                      <th scope="col">Monto</th>
                      <th scope="col">Proveedor</th>
                      <th scope="col">Registrado por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prod.movimientos.map((m, i) => (
                      <tr key={i}>
                        <td>{fmtFechaHora(m.fecha_hora)}</td>
                        <td><span className={m.tipo === "venta" ? "badge accent" : "badge neutral"}>{m.tipo === "venta" ? "Venta" : "Compra"}</span></td>
                        <td className="mono">{fmtCant(m.cantidad, prod.unidad)}</td>
                        <td className="mono">{fmtCLP(m.monto_clp)}</td>
                        <td>{m.proveedor ?? "—"}</td>
                        <td>{m.usuario}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {modal === "venta" || modal === "compra" ? (
            <MovimientoModal tipo={modal} idProducto={prod.id_producto} onClose={cerrar} onHecho={() => { cerrar(); void reload(); }} />
          ) : null}
          {modal === "editar" ? <ProductoModal producto={prod} onClose={cerrar} onHecho={() => { cerrar(); void reload(); }} /> : null}
          {modal === "estado" ? (
            <ConfirmarModal
              titulo={prod.activo ? "Desactivar producto" : "Reactivar producto"}
              confirmar={prod.activo ? "Desactivar" : "Reactivar"}
              ocupado={ocupado}
              error={errAccion}
              onConfirmar={() => void cambiarEstado()}
              onClose={cerrar}
            >
              {prod.activo
                ? "Dejará de aparecer en el Dashboard y en las predicciones, y se descartarán sus alertas activas. Su historial se conserva y puedes reactivarlo cuando quieras."
                : "Volverá a aparecer en el inventario, el Dashboard y las predicciones."}
            </ConfirmarModal>
          ) : null}
          {modal === "eliminar" ? (
            <ConfirmarModal titulo="Eliminar producto" confirmar="Eliminar" peligro ocupado={ocupado} error={errAccion} onConfirmar={() => void eliminar()} onClose={cerrar}>
              Se eliminará «{prod.nombre}» de forma permanente. Si ya tiene ventas o compras registradas no se puede eliminar; en ese caso desactívalo.
            </ConfirmarModal>
          ) : null}
        </>
      ) : null}
    </AppShell>
  );
}
