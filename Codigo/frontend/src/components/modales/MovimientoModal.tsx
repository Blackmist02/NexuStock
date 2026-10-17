"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button, SelectField, TextField } from "@/components/ui/Field";
import { Loading } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api, errorMessage } from "@/lib/api";
import { ahoraLocalInput, fmtCant, fmtCLP, localInputAISO, parseNum } from "@/lib/format";
import type { ListaProductos, Proveedor, Unidad } from "@/lib/tipos";
import { useApi } from "@/lib/useApi";

type Tipo = "venta" | "compra";

export interface ResultadoMovimiento {
  producto: string;
  unidad: Unidad;
  stock_anterior: number;
  stock_nuevo: number;
  nivel: string | null;
  alerta_generada?: boolean;
}

interface Props {
  tipo: Tipo;
  /** Producto preseleccionado (desde el detalle o una fila de la tabla). */
  idProducto?: number;
  onClose: () => void;
  onHecho: (r: ResultadoMovimiento) => void;
}

/**
 * RF-01 (venta) y RF-02 (compra): registran el movimiento y actualizan el stock en una sola operación.
 * Muestra el efecto sobre el stock antes de guardar y avisa si quedaría bajo el mínimo.
 */
export function MovimientoModal({ tipo, idProducto, onClose, onHecho }: Props) {
  const toast = useToast();
  const lista = useApi<ListaProductos>("/products", { estado: "activos" });
  const provs = useApi<{ data: Proveedor[] }>(tipo === "compra" ? "/suppliers" : null);

  const [idSel, setIdSel] = useState<string>(idProducto ? String(idProducto) : "");
  const [cantidad, setCantidad] = useState("");
  const [precio, setPrecio] = useState<string | null>(null); // null = usar el del catálogo
  const [proveedor, setProveedor] = useState<string | null>(null); // null = proveedor habitual
  const [fecha, setFecha] = useState(ahoraLocalInput());
  const [fechaCambiada, setFechaCambiada] = useState(false);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const productos = useMemo(() => lista.data?.data ?? [], [lista.data]);
  const p = productos.find((x) => String(x.id_producto) === idSel);
  const esVenta = tipo === "venta";

  const precioBase = p ? (esVenta ? p.precio_venta_clp : 0) : 0;
  const precioTxt = precio ?? (p && esVenta ? String(precioBase) : "");
  const provSel = proveedor ?? (p ? String(p.id_proveedor) : "");

  const cant = parseNum(cantidad);
  const pr = parseNum(precioTxt);
  const total = cant != null && pr != null ? Math.round(cant * pr) : null;
  const stockNuevo = p && cant != null && cant > 0 ? Math.round((p.stock_actual + (esVenta ? -cant : cant)) * 100) / 100 : null;
  const bajoMinimo = !!p && stockNuevo != null && stockNuevo >= 0 && stockNuevo < p.stock_minimo;

  async function guardar() {
    const c: Record<string, string> = {};
    if (!p) c.id_producto = "Elige un producto";
    if (cant == null || cant <= 0) c.cantidad = "Ingresa una cantidad mayor que 0";
    else if (p?.unidad === "un" && !Number.isInteger(cant)) c.cantidad = "Este producto se vende por unidad: ingresa un número entero";
    else if (esVenta && p && cant > p.stock_actual) c.cantidad = `La cantidad supera el stock disponible (${fmtCant(p.stock_actual, p.unidad)}).`;
    if (pr == null || pr < 0) c[esVenta ? "precio_unitario_clp" : "costo_unitario_clp"] = esVenta ? "Ingresa un precio válido" : "Ingresa el precio unitario de compra";
    if (!esVenta && !provSel) c.id_proveedor = "Elige el proveedor";
    setCampos(c);
    setError(null);
    if (Object.keys(c).length || !p || cant == null || pr == null) return;
    setEnviando(true);
    try {
      const cuerpo: Record<string, unknown> = { id_producto: p.id_producto, cantidad: cant };
      if (fechaCambiada) cuerpo.fecha_hora = localInputAISO(fecha);
      if (esVenta) cuerpo.precio_unitario_clp = Math.round(pr);
      else {
        cuerpo.costo_unitario_clp = Math.round(pr);
        cuerpo.id_proveedor = Number(provSel);
      }
      const r = await api.post<{ data: ResultadoMovimiento }>(esVenta ? "/sales" : "/purchases", cuerpo);
      toast.ok(esVenta ? "Venta registrada" : "Compra registrada");
      onHecho(r.data);
    } catch (e) {
      setEnviando(false);
      if (e instanceof ApiClientError) {
        const f = e.fieldErrors;
        setCampos(f);
        if (Object.keys(f).length === 0) setError(e.message);
      } else setError(errorMessage(e));
    }
  }

  return (
    <Modal
      titulo={esVenta ? "Registrar venta" : "Registrar compra"}
      subtitulo={esVenta ? "Descuenta el stock del producto vendido" : "Suma al stock lo que llegó del proveedor"}
      onClose={onClose}
      ocupado={enviando}
      pie={
        <>
          <Button onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button variant="primary" onClick={() => void guardar()} loading={enviando}>
            {esVenta ? "Registrar venta" : "Registrar compra"}
          </Button>
        </>
      }
    >
      {lista.loading && !lista.data ? (
        <Loading texto="Cargando productos…" />
      ) : (
        <div className="form-grid">
          <SelectField
            className="full"
            label="Producto"
            value={idSel}
            error={campos.id_producto}
            disabled={!!idProducto}
            onChange={(e) => {
              setIdSel(e.target.value);
              setPrecio(null);
              setProveedor(null);
            }}
          >
            <option value="">Elige un producto…</option>
            {productos.map((x) => (
              <option key={x.id_producto} value={x.id_producto}>
                {x.nombre} · {fmtCant(x.stock_actual, x.unidad)}
              </option>
            ))}
          </SelectField>
          <TextField
            label={`Cantidad${p ? ` (${p.unidad})` : ""}`}
            inputMode="decimal"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            error={campos.cantidad}
            placeholder={p?.unidad === "un" ? "Ej.: 3" : "Ej.: 2,5"}
          />
          <TextField
            label={esVenta ? "Precio unitario (CLP)" : "Precio unitario de compra (CLP)"}
            inputMode="numeric"
            value={precioTxt}
            onChange={(e) => setPrecio(e.target.value)}
            error={campos.precio_unitario_clp ?? campos.costo_unitario_clp}
            placeholder="Ej.: 9.990"
            hint={esVenta && p ? "Precargado desde el catálogo" : undefined}
          />
          {!esVenta ? (
            <SelectField className="full" label="Proveedor" value={provSel} error={campos.id_proveedor} onChange={(e) => setProveedor(e.target.value)}>
              <option value="">Elige un proveedor…</option>
              {(provs.data?.data ?? []).filter((x) => x.activo).map((x) => (
                <option key={x.id_proveedor} value={x.id_proveedor}>
                  {x.nombre}
                  {p && x.id_proveedor === p.id_proveedor ? " (habitual)" : ""}
                </option>
              ))}
            </SelectField>
          ) : null}
          <TextField
            className="full"
            label="Fecha y hora"
            type="datetime-local"
            value={fecha}
            max={ahoraLocalInput()}
            onChange={(e) => {
              setFecha(e.target.value);
              setFechaCambiada(true);
            }}
            error={campos.fecha_hora}
            hint="Por defecto, ahora. Cámbiala si registras un movimiento anterior."
          />
          {p && stockNuevo != null ? (
            <div className={`summary full${bajoMinimo || stockNuevo < 0 ? " warn" : ""}`} style={{ gridColumn: "1 / -1", marginTop: 0 }}>
              Stock de <b>{p.nombre}</b>: <b>{fmtCant(p.stock_actual, p.unidad)}</b> → <b>{fmtCant(stockNuevo, p.unidad)}</b>
              {total != null ? <> · {esVenta ? "Total" : "Costo total"}: <b>{fmtCLP(total)}</b></> : null}
              {bajoMinimo && esVenta ? <div>Con esta venta el producto quedará bajo su stock mínimo ({fmtCant(p.stock_minimo, p.unidad)}).</div> : null}
            </div>
          ) : null}
        </div>
      )}
      {error ? (
        <div className="form-err" role="alert" style={{ marginTop: 14 }}>
          {error}
        </div>
      ) : null}
    </Modal>
  );
}

export const RegistrarVentaModal = (p: Omit<Props, "tipo">) => <MovimientoModal tipo="venta" {...p} />;
export const RegistrarCompraModal = (p: Omit<Props, "tipo">) => <MovimientoModal tipo="compra" {...p} />;
