"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { fmtCLP, fmtFecha, fmtNum } from "@/lib/format";
import type { ConfigFecha } from "@/lib/tipos";

const sumarDias = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const ORIGEN: Record<ConfigFecha["origen"], string> = {
  real: "Fecha real",
  base: "Fecha de referencia guardada",
  entorno: "Fecha de referencia (variable FECHA_REFERENCIA)",
};

type Evaluacion = { evaluados: number; creadas: number; cerradas: number } | null;

/** Fecha del sistema («hoy»): se guarda en la base y cambia sin reiniciar; recalcula proyecciones y alertas. */
export function FechaSistemaCard({ fecha, onCambio }: { fecha: ConfigFecha; onCambio: () => void }) {
  const toast = useToast();
  const [valor, setValor] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elegido = valor ?? fecha.hoy;

  async function guardar(nueva: string | null) {
    setGuardando(true);
    setError(null);
    try {
      const r = await api.put<{ data: { fecha: ConfigFecha; evaluacion: Evaluacion } }>("/config/fecha", { fecha: nueva });
      const ev = r.data.evaluacion;
      toast.ok(`Fecha del sistema: ${fmtFecha(r.data.fecha.hoy)}${ev ? ` · alertas: ${ev.creadas} nuevas, ${ev.cerradas} cerradas` : ""}`);
      setValor(null);
      onCambio();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  const masSiete = sumarDias(fecha.hoy, 7) <= fecha.real ? sumarDias(fecha.hoy, 7) : fecha.real;
  const u = fecha.ultimos_movimientos;

  return (
    <div className="card">
      <div className="title">Fecha del sistema</div>
      <div className="fecha-sistema">
        <div>
          <div className="lbl">Hoy en NexuStock</div>
          <div className="val">{fmtFecha(fecha.hoy)}</div>
          <span className={fecha.origen === "real" ? "badge neutral" : "badge accent"}>{ORIGEN[fecha.origen]}</span>
        </div>
        <div className="hint">
          Último movimiento cargado: ventas {u.venta ? fmtFecha(u.venta) : "—"} · compras {u.compra ? fmtFecha(u.compra) : "—"} · mermas{" "}
          {u.merma ? fmtFecha(u.merma) : "—"}
        </div>
      </div>
      <div className="row-actions" style={{ flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <label className="sr-only" htmlFor="fecha-sistema">Nueva fecha del sistema</label>
        <input
          id="fecha-sistema"
          className="input surface"
          type="date"
          style={{ height: 32, width: "auto" }}
          value={elegido}
          min={fecha.minima ?? undefined}
          max={fecha.real}
          onChange={(e) => setValor(e.target.value)}
        />
        <Button size="sm" variant="primary" loading={guardando} disabled={!elegido || elegido === fecha.referencia} onClick={() => void guardar(elegido)}>
          Guardar fecha
        </Button>
        <Button size="sm" disabled={guardando || masSiete === fecha.hoy} onClick={() => setValor(masSiete)}>+7 días</Button>
        {fecha.origen !== "real" ? (
          <Button size="sm" disabled={guardando} onClick={() => void guardar(null)}>Usar la fecha real</Button>
        ) : null}
      </div>
      {error ? <div className="form-err" role="alert" style={{ marginTop: 10 }}>{error}</div> : null}
      <p className="hint" style={{ margin: "10px 0 0" }}>
        Con datos históricos, «hoy» es el día siguiente al último movimiento cargado. Al cambiarla se recalculan la proyección de la semana y las alertas.
        No puede ser futura ni anterior al último movimiento.
      </p>
    </div>
  );
}

type Tipo = "ventas" | "compras" | "mermas";
const TIPOS: { t: Tipo; nombre: string; ayuda: string }[] = [
  { t: "ventas", nombre: "Ventas", ayuda: "fecha; hora; producto; cantidad; precio_unitario_clp" },
  { t: "compras", nombre: "Compras", ayuda: "fecha; hora; producto; cantidad; costo_unitario_clp; proveedor (opcional)" },
  { t: "mermas", nombre: "Mermas", ayuda: "fecha; hora; producto; cantidad; motivo; costo_unitario_clp (opcional)" },
];

interface ResumenTipo {
  filas: number;
  validas: number;
  ya_cargadas: number;
  posteriores: number;
  a_importar: number;
  desde: string | null;
  hasta: string | null;
  cantidad: number;
  monto_clp: number;
  ultimo_registrado: string | null;
}

interface Revision {
  valido: boolean;
  hasta: string | null;
  fecha_sistema: { actual: string; nueva: string | null };
  tipos: Partial<Record<Tipo, ResumenTipo>>;
  total_a_importar: number;
  errores_generales: string[];
  errores: { tipo: Tipo; linea: number; mensaje: string }[];
  total_errores: number;
  advertencias: { tipo: Tipo; linea: number; mensaje: string }[];
  total_advertencias: number;
  kg_ajustados: number;
  stock: { producto: string; unidad: string; antes: number; despues: number }[];
}

/** Carga de ventas, compras y mermas desde CSV (plantillas), con revisión previa y opción de avanzar la fecha. */
export function CargaDatosCard({ fecha, onCambio }: { fecha: ConfigFecha; onCambio: () => void }) {
  const toast = useToast();
  const [archivos, setArchivos] = useState<Partial<Record<Tipo, File>>>({});
  const [hasta, setHasta] = useState("");
  const [avanzar, setAvanzar] = useState(fecha.origen !== "real");
  const [revision, setRevision] = useState<Revision | null>(null);
  const [ocupado, setOcupado] = useState<null | "revisar" | "importar">(null);
  const [error, setError] = useState<string | null>(null);

  const invalidar = () => {
    setRevision(null);
    setError(null);
  };

  async function cuerpo() {
    const c: Record<string, unknown> = { avanzar, hasta: hasta || null };
    for (const { t } of TIPOS) if (archivos[t]) c[t] = await archivos[t]!.text();
    return c;
  }

  async function revisar() {
    setOcupado("revisar");
    setError(null);
    try {
      const r = await api.post<{ data: Revision }>("/import/validar", await cuerpo());
      setRevision(r.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOcupado(null);
    }
  }

  async function importar() {
    setOcupado("importar");
    setError(null);
    try {
      const r = await api.post<{ data: Revision & { evaluacion: Evaluacion } }>("/import", await cuerpo());
      const ev = r.data.evaluacion;
      toast.ok(
        `Importados ${r.data.total_a_importar} movimientos` +
          (r.data.fecha_sistema.nueva ? ` · fecha del sistema: ${fmtFecha(r.data.fecha_sistema.nueva)}` : "") +
          (ev ? ` · alertas: ${ev.creadas} nuevas, ${ev.cerradas} cerradas` : ""),
      );
      setArchivos({});
      setHasta("");
      setRevision(null);
      onCambio();
    } catch (e) {
      setError(errorMessage(e));
      void revisar(); // muestra el detalle actualizado
    } finally {
      setOcupado(null);
    }
  }

  const hayArchivos = TIPOS.some(({ t }) => archivos[t]);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="title">Carga de datos (CSV)</div>
      <p className="hint" style={{ margin: "0 0 12px" }}>
        Sube ventas, compras y mermas con las plantillas. Se importa solo lo posterior a lo ya cargado y hasta la fecha límite, así que puedes subir el
        archivo completo cada semana. Se acepta el CSV de Excel (separador «;» y coma decimal) o con comas.
      </p>
      <div className="carga-grid">
        {TIPOS.map(({ t, nombre, ayuda }) => (
          <div key={t} className="carga-item">
            <div className="carga-cab">
              <label htmlFor={`csv-${t}`}><b>{nombre}</b></label>
              <button type="button" className="linkbtn" onClick={() => void api.download(`/import/plantilla/${t}`, undefined, `plantilla-${t}.csv`).catch((e) => toast.error(errorMessage(e)))}>
                Descargar plantilla
              </button>
            </div>
            <input
              id={`csv-${t}`}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setArchivos((a) => ({ ...a, [t]: f }));
                invalidar();
              }}
            />
            <div className="mini">{archivos[t] ? `${archivos[t]!.name} · ${fmtNum(archivos[t]!.size / 1024, 0)} KB` : ayuda}</div>
          </div>
        ))}
      </div>
      <div className="row-actions" style={{ flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <label className="hint" htmlFor="csv-hasta">Cargar hasta (incluido)</label>
        <input id="csv-hasta" className="input surface" type="date" style={{ height: 32, width: "auto" }} value={hasta} max={fecha.real} onChange={(e) => { setHasta(e.target.value); invalidar(); }} />
        <span className="mini">{hasta ? "" : "Vacío: hasta la última fecha de los archivos"}</span>
        <label className="checkrow" style={{ marginLeft: 8 }}>
          <input type="checkbox" checked={avanzar} onChange={(e) => { setAvanzar(e.target.checked); invalidar(); }} />
          <span>Mover la fecha del sistema al día siguiente de la carga</span>
        </label>
      </div>
      <div className="row-actions" style={{ marginTop: 12 }}>
        <Button size="sm" disabled={!hayArchivos || !!ocupado} loading={ocupado === "revisar"} onClick={() => void revisar()}>Revisar archivos</Button>
        <Button size="sm" variant="primary" disabled={!revision?.valido || !!ocupado} loading={ocupado === "importar"} onClick={() => void importar()}>
          {revision?.valido ? `Importar ${revision.total_a_importar} movimientos` : "Importar"}
        </Button>
      </div>
      {error ? <div className="form-err" role="alert" style={{ marginTop: 10 }}>{error}</div> : null}

      {revision ? (
        <div className="carga-revision">
          {revision.valido ? (
            <div className="callout ok" role="status">
              <span>
                Todo en orden: se importarán <b>{revision.total_a_importar}</b> movimientos hasta el {revision.hasta ? fmtFecha(revision.hasta) : "—"}.
                {revision.fecha_sistema.nueva ? <> La fecha del sistema pasará del {fmtFecha(revision.fecha_sistema.actual)} al <b>{fmtFecha(revision.fecha_sistema.nueva)}</b>.</> : null}
              </span>
            </div>
          ) : (
            <div className="callout err" role="alert">
              <span>
                <b>No se puede importar.</b> {revision.errores_generales.join(" ")}
                {revision.total_errores ? ` Hay ${revision.total_errores} ${revision.total_errores === 1 ? "fila con error" : "filas con errores"}.` : ""}
              </span>
            </div>
          )}
          <div className="scrollx">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Archivo</th>
                  <th scope="col" className="right">Filas</th>
                  <th scope="col" className="right">Ya cargadas</th>
                  <th scope="col" className="right">Después del límite</th>
                  <th scope="col" className="right">A importar</th>
                  <th scope="col">Periodo</th>
                  <th scope="col" className="right">Cantidad</th>
                  <th scope="col" className="right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {TIPOS.filter(({ t }) => revision.tipos[t]).map(({ t, nombre }) => {
                  const r = revision.tipos[t]!;
                  return (
                    <tr key={t}>
                      <td>{nombre}<div className="mini">{r.ultimo_registrado ? `cargado hasta ${fmtFecha(r.ultimo_registrado.slice(0, 10))}` : "sin datos previos"}</div></td>
                      <td className="mono right">{r.filas}</td>
                      <td className="mono right">{r.ya_cargadas}</td>
                      <td className="mono right">{r.posteriores}</td>
                      <td className="mono right"><b>{r.a_importar}</b></td>
                      <td>{r.desde ? `${fmtFecha(r.desde)} – ${fmtFecha(r.hasta)}` : "—"}</td>
                      <td className="mono right">{fmtNum(r.cantidad)} kg</td>
                      <td className="mono right">{fmtCLP(r.monto_clp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {revision.errores.length ? (
            <ul className="carga-lista err">
              {revision.errores.map((e) => <li key={`${e.tipo}-${e.linea}-${e.mensaje}`}><b>{e.tipo}, línea {e.linea}:</b> {e.mensaje}</li>)}
              {revision.total_errores > revision.errores.length ? <li>… y {revision.total_errores - revision.errores.length} más.</li> : null}
            </ul>
          ) : null}
          {revision.total_advertencias ? (
            <details className="carga-lista">
              <summary>
                {revision.total_advertencias} {revision.total_advertencias === 1 ? "ajuste" : "ajustes"} por redondeo del pesaje ({fmtNum(revision.kg_ajustados, 2)} kg): el stock queda en 0
              </summary>
              <ul>{revision.advertencias.map((a) => <li key={`${a.tipo}-${a.linea}`}><b>{a.tipo}, línea {a.linea}:</b> {a.mensaje}</li>)}</ul>
            </details>
          ) : null}
          {revision.valido && revision.stock.length ? (
            <details className="carga-lista">
              <summary>Stock resultante de {revision.stock.length} productos</summary>
              <ul>{revision.stock.map((s) => <li key={s.producto}>{s.producto}: {fmtNum(s.antes)} → <b>{fmtNum(s.despues)}</b> {s.unidad}</li>)}</ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
