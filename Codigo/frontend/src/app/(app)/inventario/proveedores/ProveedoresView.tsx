"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { SubNav } from "@/components/SubNav";
import { Button } from "@/components/ui/Field";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { CategoriaModal } from "@/components/modales/CategoriaModal";
import { ConfirmarModal } from "@/components/modales/ConfirmarModal";
import { ProveedorModal } from "@/components/modales/ProveedorModal";
import { useAuth } from "@/lib/auth";
import { api, errorMessage } from "@/lib/api";
import { DIAS_SEMANA, fmtCLP } from "@/lib/format";
import { puede } from "@/lib/permisos";
import type { Categoria, Proveedor } from "@/lib/tipos";
import { useApi } from "@/lib/useApi";
import { TABS_INVENTARIO } from "../layoutTabs";

type Accion =
  | null
  | { t: "proveedor"; p?: Proveedor }
  | { t: "categoria"; c?: Categoria }
  | { t: "estado"; p: Proveedor }
  | { t: "borrar-proveedor"; p: Proveedor }
  | { t: "borrar-categoria"; c: Categoria };

const diasTxt = (d: number[]) => (d.length === 7 ? "Todos los días" : d.map((x) => DIAS_SEMANA[x]).join(" · "));

export function ProveedoresView() {
  const { user } = useAuth();
  const toast = useToast();
  const edita = puede(user?.rol, "catalogo");
  const provs = useApi<{ data: Proveedor[] }>("/suppliers", { todos: 1 }, { resguardo: true });
  const cats = useApi<{ data: Categoria[] }>("/categories", undefined, { resguardo: true });
  const [accion, setAccion] = useState<Accion>(null);
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cerrar = () => {
    setAccion(null);
    setErr(null);
  };
  const recargar = () => {
    void provs.reload();
    void cats.reload();
  };

  async function ejecutar(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    setErr(null);
    try {
      await fn();
      toast.ok(ok);
      cerrar();
      recargar();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <AppShell active="inventario">
      <div className="topbar">
        <div>
          <h1 className="h1">Inventario</h1>
          <div className="subtitle">Proveedores, tiempos de entrega y categorías</div>
        </div>
      </div>
      <SubNav items={TABS_INVENTARIO} activa="/inventario/proveedores" />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="title">
          Proveedores
          {edita ? <Button size="sm" variant="primary" onClick={() => setAccion({ t: "proveedor" })}>Nuevo proveedor</Button> : null}
        </div>
        {!provs.data && provs.loading ? <Loading /> : null}
        {!provs.data && provs.error ? <ErrorState message={provs.error} onRetry={() => void provs.reload()} /> : null}
        {provs.data && provs.data.data.length === 0 ? <EmptyState title="Aún no hay proveedores" text="Crea un proveedor antes de agregar productos." /> : null}
        {provs.data && provs.data.data.length > 0 ? (
          <div className="scrollx">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Proveedor</th>
                  <th scope="col">Lead time</th>
                  <th scope="col">Días hábiles</th>
                  <th scope="col">Productos</th>
                  <th scope="col">Compras 30 días</th>
                  <th scope="col">Estado</th>
                  {edita ? <th scope="col"><span className="sr-only">Acciones</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {provs.data.data.map((p) => (
                  <tr key={p.id_proveedor} style={p.activo ? undefined : { opacity: 0.6 }}>
                    <td>{p.nombre}<div className="mini">{p.contacto ?? "Sin contacto"}</div></td>
                    <td className="mono">{p.lead_time_dias} {p.lead_time_dias === 1 ? "día" : "días"}</td>
                    <td>{diasTxt(p.dias_habiles)}</td>
                    <td className="mono">{p.productos}</td>
                    <td className="mono">{fmtCLP(p.compras_30d_clp)}</td>
                    <td><span className={p.activo ? "badge saludable" : "badge neutral"}>{p.activo ? "Activo" : "Inactivo"}</span></td>
                    {edita ? (
                      <td>
                        <div className="row-actions">
                          <Button size="sm" onClick={() => setAccion({ t: "proveedor", p })}>Editar</Button>
                          <Button size="sm" onClick={() => setAccion({ t: "estado", p })}>{p.activo ? "Desactivar" : "Reactivar"}</Button>
                          <Button size="sm" variant="danger" onClick={() => setAccion({ t: "borrar-proveedor", p })}>Eliminar</Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="hint" style={{ margin: "10px 0 0" }}>
          El lead time y los días hábiles definen cuánto debe cubrir el stock (hasta que llega el pedido siguiente). Si la fecha límite para pedir cae en un
          día sin atención del proveedor, se adelanta al día hábil anterior.
        </p>
      </div>

      <div className="card">
        <div className="title">
          Categorías
          {edita ? <Button size="sm" variant="primary" onClick={() => setAccion({ t: "categoria" })}>Nueva categoría</Button> : null}
        </div>
        {!cats.data && cats.loading ? <Loading /> : null}
        {!cats.data && cats.error ? <ErrorState message={cats.error} onRetry={() => void cats.reload()} /> : null}
        {cats.data && cats.data.data.length === 0 ? <EmptyState title="Aún no hay categorías" text="Las categorías agrupan tus productos (vacuno, cerdo, pollo…)." /> : null}
        {cats.data && cats.data.data.length > 0 ? (
          <div className="scrollx">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Categoría</th>
                  <th scope="col">Productos activos</th>
                  {edita ? <th scope="col"><span className="sr-only">Acciones</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {cats.data.data.map((c) => (
                  <tr key={c.id_categoria}>
                    <td>{c.nombre}</td>
                    <td className="mono">{c.productos}</td>
                    {edita ? (
                      <td>
                        <div className="row-actions">
                          <Button size="sm" onClick={() => setAccion({ t: "categoria", c })}>Editar</Button>
                          <Button size="sm" variant="danger" onClick={() => setAccion({ t: "borrar-categoria", c })}>Eliminar</Button>
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

      {accion?.t === "proveedor" ? <ProveedorModal proveedor={accion.p} onClose={cerrar} onHecho={() => { cerrar(); recargar(); }} /> : null}
      {accion?.t === "categoria" ? <CategoriaModal categoria={accion.c} onClose={cerrar} onHecho={() => { cerrar(); recargar(); }} /> : null}
      {accion?.t === "estado" ? (
        <ConfirmarModal
          titulo={accion.p.activo ? "Desactivar proveedor" : "Reactivar proveedor"}
          confirmar={accion.p.activo ? "Desactivar" : "Reactivar"}
          ocupado={ocupado}
          error={err}
          onClose={cerrar}
          onConfirmar={() => { const p = accion.p; void ejecutar(() => api.patch(`/suppliers/${p.id_proveedor}/estado`, { activo: !p.activo }), p.activo ? "Proveedor desactivado" : "Proveedor reactivado"); }}
        >
          {accion.p.activo ? `«${accion.p.nombre}» dejará de ofrecerse al crear compras o productos. Si tiene productos activos asignados, primero cámbiales el proveedor.` : `«${accion.p.nombre}» volverá a estar disponible.`}
        </ConfirmarModal>
      ) : null}
      {accion?.t === "borrar-proveedor" ? (
        <ConfirmarModal titulo="Eliminar proveedor" confirmar="Eliminar" peligro ocupado={ocupado} error={err} onClose={cerrar}
          onConfirmar={() => { const p = accion.p; void ejecutar(() => api.delete(`/suppliers/${p.id_proveedor}`), "Proveedor eliminado"); }}>
          Se eliminará «{accion.p.nombre}». Si tiene productos o compras asociadas no se podrá eliminar; en ese caso desactívalo.
        </ConfirmarModal>
      ) : null}
      {accion?.t === "borrar-categoria" ? (
        <ConfirmarModal titulo="Eliminar categoría" confirmar="Eliminar" peligro ocupado={ocupado} error={err} onClose={cerrar}
          onConfirmar={() => { const c = accion.c; void ejecutar(() => api.delete(`/categories/${c.id_categoria}`), "Categoría eliminada"); }}>
          Se eliminará la categoría «{accion.c.nombre}». Solo es posible si no tiene productos asociados.
        </ConfirmarModal>
      ) : null}
    </AppShell>
  );
}
