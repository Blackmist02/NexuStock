"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button, SelectField, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { parseNum } from "@/lib/format";
import type { Categoria, DetalleProducto, Proveedor, Unidad } from "@/lib/tipos";
import { useApi } from "@/lib/useApi";
import { useGuardar } from "./useGuardar";

interface Props {
  /** Si viene, se edita; si no, se crea. */
  producto?: DetalleProducto;
  onClose: () => void;
  onHecho: (id: number) => void;
}

const txt = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

/** RF-03 (alta) y edición del catálogo. El stock inicial solo se pide al crear; después cambia con ventas y compras. */
export function ProductoModal({ producto, onClose, onHecho }: Props) {
  const toast = useToast();
  const cats = useApi<{ data: Categoria[] }>("/categories");
  const provs = useApi<{ data: Proveedor[] }>("/suppliers");
  const g = useGuardar();
  const edita = !!producto;

  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [cat, setCat] = useState(producto ? String(producto.id_categoria) : "");
  const [prov, setProv] = useState(producto ? String(producto.id_proveedor) : "");
  const [unidad, setUnidad] = useState<Unidad>(producto?.unidad ?? "kg");
  const [precio, setPrecio] = useState(txt(producto?.precio_venta_clp));
  const [minimo, setMinimo] = useState(txt(producto?.stock_minimo ?? 0));
  const [inicial, setInicial] = useState("0");
  const [vida, setVida] = useState(txt(producto?.vida_util_dias));
  const [margen, setMargen] = useState(txt(producto?.margen_seguridad_pct ?? 20));

  async function guardar() {
    const c: Record<string, string> = {};
    const nPrecio = parseNum(precio);
    const nMin = parseNum(minimo);
    const nIni = parseNum(inicial);
    const nVida = vida.trim() ? parseNum(vida) : null;
    const nMargen = parseNum(margen);
    if (nombre.trim().length < 2) c.nombre = "Ingresa el nombre del producto";
    if (!cat) c.id_categoria = "Elige una categoría";
    if (!prov) c.id_proveedor = "Elige el proveedor habitual";
    if (nPrecio == null || nPrecio < 0) c.precio_venta_clp = "El precio de venta debe ser un número válido";
    if (nMin == null || nMin < 0) c.stock_minimo = "El stock mínimo debe ser 0 o más";
    if (!edita && (nIni == null || nIni < 0)) c.stock_inicial = "El stock inicial debe ser 0 o más";
    if (vida.trim() && (nVida == null || nVida < 1 || !Number.isInteger(nVida))) c.vida_util_dias = "La vida útil debe ser un número de días mayor que 0";
    if (nMargen == null || nMargen < 0) c.margen_seguridad_pct = "El margen debe ser 0 o más";
    g.setCampos(c);
    if (Object.keys(c).length) return;
    const cuerpo = {
      nombre: nombre.trim(),
      id_categoria: Number(cat),
      id_proveedor: Number(prov),
      unidad,
      precio_venta_clp: Math.round(nPrecio ?? 0),
      stock_minimo: nMin ?? 0,
      ...(edita ? {} : { stock_inicial: nIni ?? 0 }),
      vida_util_dias: nVida,
      margen_seguridad_pct: nMargen ?? 20,
    };
    const r = await g.ejecutar(() =>
      edita ? api.put<{ data: DetalleProducto }>(`/products/${producto.id_producto}`, cuerpo) : api.post<{ data: DetalleProducto }>("/products", cuerpo),
    );
    if (r) {
      toast.ok(edita ? "Producto actualizado" : "Producto creado");
      onHecho(r.data.id_producto);
    }
  }

  return (
    <Modal
      titulo={edita ? "Editar producto" : "Nuevo producto"}
      subtitulo={edita ? "El stock solo cambia con ventas y compras, para mantener la trazabilidad." : "Datos del catálogo y stock con el que parte."}
      onClose={onClose}
      ocupado={g.enviando}
      ancho={560}
      pie={
        <>
          <Button onClick={onClose} disabled={g.enviando}>Cancelar</Button>
          <Button variant="primary" onClick={() => void guardar()} loading={g.enviando}>{edita ? "Guardar cambios" : "Crear producto"}</Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField className="full" label="Nombre" placeholder="Ej.: Lomo vetado" value={nombre} onChange={(e) => setNombre(e.target.value)} error={g.campos.nombre} />
        <SelectField label="Categoría" value={cat} onChange={(e) => setCat(e.target.value)} error={g.campos.id_categoria}>
          <option value="">Elige una categoría…</option>
          {(cats.data?.data ?? []).map((c) => <option key={c.id_categoria} value={c.id_categoria}>{c.nombre}</option>)}
        </SelectField>
        <SelectField label="Proveedor habitual" value={prov} onChange={(e) => setProv(e.target.value)} error={g.campos.id_proveedor}>
          <option value="">Elige un proveedor…</option>
          {(provs.data?.data ?? []).filter((p) => p.activo || String(p.id_proveedor) === prov).map((p) => <option key={p.id_proveedor} value={p.id_proveedor}>{p.nombre}</option>)}
        </SelectField>
        <SelectField label="Unidad de medida" value={unidad} onChange={(e) => setUnidad(e.target.value as Unidad)} error={g.campos.unidad}>
          <option value="kg">Kilos (kg)</option>
          <option value="un">Unidades (un)</option>
        </SelectField>
        <TextField label="Precio de venta (CLP)" placeholder="Ej.: 9.990" inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} error={g.campos.precio_venta_clp} />
        <TextField label={`Stock mínimo (${unidad})`} placeholder="Ej.: 5" inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} error={g.campos.stock_minimo} />
        {!edita ? <TextField label={`Stock inicial (${unidad})`} placeholder="Ej.: 20" inputMode="decimal" value={inicial} onChange={(e) => setInicial(e.target.value)} error={g.campos.stock_inicial} /> : null}
        <TextField label="Vida útil (días)" placeholder="Ej.: 5" inputMode="numeric" value={vida} onChange={(e) => setVida(e.target.value)} error={g.campos.vida_util_dias} hint="Opcional. Limita cuánto conviene comprar de una vez." />
        <TextField label="Margen de seguridad (%)" placeholder="Ej.: 20" inputMode="decimal" value={margen} onChange={(e) => setMargen(e.target.value)} error={g.campos.margen_seguridad_pct} hint="Se suma a la demanda proyectada." />
      </div>
      {!edita ? (
        <div className="callout info" style={{ marginTop: 14 }}>
          <span>Mientras el producto no tenga ventas registradas, su demanda se estima con el promedio de su categoría.</span>
        </div>
      ) : null}
      {g.error ? <div className="form-err" role="alert" style={{ marginTop: 14 }}>{g.error}</div> : null}
    </Modal>
  );
}
