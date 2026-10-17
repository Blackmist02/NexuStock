"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { SubNav } from "@/components/SubNav";
import { Button } from "@/components/ui/Field";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { MovimientoModal } from "@/components/modales/MovimientoModal";
import { ProductoModal } from "@/components/modales/ProductoModal";
import { useAuth } from "@/lib/auth";
import { api, errorMessage } from "@/lib/api";
import { fmtCant, fmtCLP, fmtFechaHora, NIVEL_BADGE, NIVEL_LABEL, type Nivel } from "@/lib/format";
import { puede } from "@/lib/permisos";
import type { Categoria, ListaProductos } from "@/lib/tipos";
import { useApi } from "@/lib/useApi";
import { useDebounced } from "@/lib/useDebounced";
import { TABS_INVENTARIO } from "./layoutTabs";

type Filtro = "todos" | Nivel;

export function InventarioView() {
  const { user } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [nivel, setNivel] = useState<Filtro>("todos");
  const [categoria, setCategoria] = useState("");
  const [inactivos, setInactivos] = useState(false);
  const [modal, setModal] = useState<null | { tipo: "venta" | "compra"; id?: number } | "producto">(null);
  const qd = useDebounced(q.trim());

  const cats = useApi<{ data: Categoria[] }>("/categories");
  const { data, error, loading, obsoleto, reload } = useApi<ListaProductos>(
    "/products",
    { q: qd, nivel: nivel === "todos" ? undefined : nivel, categoria, estado: inactivos ? "todos" : "activos" },
    { resguardo: true },
  );
  const resumen = data?.resumen;

  async function exportar() {
    try {
      await api.download("/products/export.csv", { q: qd, nivel: nivel === "todos" ? undefined : nivel, categoria, estado: inactivos ? "todos" : "activos" }, "inventario.csv");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const chip = (k: Filtro, label: string, n?: number) => (
    <button type="button" className={`chip${nivel === k ? " on" : ""}`} aria-pressed={nivel === k} onClick={() => setNivel(k)}>
      {label}
      {n !== undefined ? ` · ${n}` : ""}
    </button>
  );

  return (
    <AppShell active="inventario">
      <div className="topbar">
        <div>
          <h1 className="h1">Inventario</h1>
          <div className="subtitle">
            Productos, stock y estado{data ? ` · actualizado ${fmtFechaHora(data.actualizado_en)}` : ""}
            {obsoleto ? " · datos guardados en este dispositivo" : ""}
          </div>
        </div>
        <div className="topbar-right">
          <label className="searchbox">
            <span className="sr-only">Buscar producto</span>
            <input type="search" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <Button size="sm" onClick={() => void exportar()}>Exportar CSV</Button>
          {puede(user?.rol, "movimientos") ? (
            <>
              <Button size="sm" onClick={() => setModal({ tipo: "compra" })}>Registrar compra</Button>
              <Button size="sm" variant="primary" onClick={() => setModal({ tipo: "venta" })}>Registrar venta</Button>
            </>
          ) : null}
          {puede(user?.rol, "catalogo") ? <Button size="sm" variant="primary" onClick={() => setModal("producto")}>Nuevo producto</Button> : null}
        </div>
      </div>
      <SubNav items={TABS_INVENTARIO} activa="/inventario" />

      <div className="filters">
        <div className="chips" role="group" aria-label="Filtrar por estado">
          {chip("todos", "Todos", resumen?.total)}
          {chip("quiebre", "Quiebre", resumen?.quiebre)}
          {chip("bajo", "Bajo", resumen?.bajo)}
          {chip("optimo", "Óptimo", resumen?.optimo)}
        </div>
        <div className="topbar-right">
          <select className="input surface" style={{ height: 32, width: "auto" }} aria-label="Categoría" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas las categorías</option>
            {(cats.data?.data ?? []).map((c) => <option key={c.id_categoria} value={c.id_categoria}>{c.nombre}</option>)}
          </select>
          {puede(user?.rol, "catalogo") ? (
            <label className="checkrow" style={{ alignItems: "center" }}>
              <input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} />
              Ver inactivos
            </label>
          ) : null}
        </div>
      </div>

      <div className="card">
        {!data && loading ? <Loading texto="Cargando el inventario…" /> : null}
        {!data && error ? <ErrorState message={error} onRetry={() => void reload()} /> : null}
        {data && data.data.length === 0 ? (
          <EmptyState
            title={qd || nivel !== "todos" || categoria ? "Ningún producto coincide con los filtros" : "Aún no tienes productos"}
            text={qd || nivel !== "todos" || categoria ? "Prueba con otra búsqueda o quita los filtros." : "Crea tu primer producto para empezar a registrar ventas y compras."}
            action={!qd && nivel === "todos" && !categoria && puede(user?.rol, "catalogo") ? <Button variant="primary" size="sm" onClick={() => setModal("producto")}>Nuevo producto</Button> : undefined}
          />
        ) : null}
        {data && data.data.length > 0 ? (
          <div className="scrollx">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col">Categoría</th>
                  <th scope="col">Stock</th>
                  <th scope="col">Mínimo</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Precio</th>
                  <th scope="col">Última compra</th>
                  <th scope="col"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => (
                  <tr key={p.id_producto} style={p.activo ? undefined : { opacity: 0.6 }}>
                    <td>
                      <Link href={`/inventario/${p.id_producto}`} className="heading-link">{p.nombre}</Link>
                      <div className="mini">{p.proveedor}</div>
                    </td>
                    <td>{p.categoria}</td>
                    <td className="mono">{fmtCant(p.stock_actual, p.unidad)}</td>
                    <td className="mono">{fmtCant(p.stock_minimo, p.unidad)}</td>
                    <td>{p.nivel ? <span className={NIVEL_BADGE[p.nivel]}>{NIVEL_LABEL[p.nivel]}</span> : <span className="badge neutral">Inactivo</span>}</td>
                    <td className="mono">{fmtCLP(p.precio_venta_clp)}</td>
                    <td>{fmtFechaHora(p.ultima_compra)}</td>
                    <td>
                      <div className="row-actions">
                        {p.activo && puede(user?.rol, "movimientos") ? (
                          <>
                            <Button size="sm" onClick={() => setModal({ tipo: "compra", id: p.id_producto })}>Compra</Button>
                            <Button size="sm" onClick={() => setModal({ tipo: "venta", id: p.id_producto })}>Venta</Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {modal === "producto" ? (
        <ProductoModal onClose={() => setModal(null)} onHecho={() => { setModal(null); void reload(); }} />
      ) : modal ? (
        <MovimientoModal
          tipo={modal.tipo}
          idProducto={modal.id}
          onClose={() => setModal(null)}
          onHecho={(r) => {
            setModal(null);
            if (r.alerta_generada) toast.ok(`«${r.producto}» quedó ${r.nivel === "quiebre" ? "en quiebre" : "con stock bajo"}: revisa Predicción.`);
            void reload();
          }}
        />
      ) : null}
    </AppShell>
  );
}
