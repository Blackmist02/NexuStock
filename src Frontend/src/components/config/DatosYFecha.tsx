"use client";

import { useState } from "react";
import { AvisoFechaPasada, AvisoSinDatos, diasSinDatos } from "@/components/FechaSistema";
import { ConfirmarModal } from "@/components/modales/ConfirmarModal";
import { Button } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { avisarCambioFecha, cambiarFechaSistema, mensajeCambioFecha } from "@/lib/fechaSistema";
import { fmtCLP, fmtFecha, fmtNum } from "@/lib/format";
import { recortarCsv, type Recorte } from "@/lib/recorteCsv";
import type { ConfigFecha } from "@/lib/tipos";
import type { Evaluacion } from "@/lib/fechaSistema";

const sumarDias = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const ORIGEN: Record<ConfigFecha["origen"], string> = {
  real: "Fecha real",
  base: "Fecha de referencia guardada",
  entorno: "Fecha de referencia (variable FECHA_REFERENCIA)",
};

/** Fecha del sistema («hoy»): se guarda en la base y cambia sin reiniciar; recalcula proyecciones y alertas. */
export function FechaSistemaCard({ fecha, onCambio }: { fecha: ConfigFecha; onCambio: () => void }) {
  const toast = useToast();
  const [valor, setValor] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<null | "pasada" | "sinDatos">(null);
  const elegido = valor ?? fecha.hoy;

  /** Guarda la fecha; antes avisa si es anterior a los datos o deja días sin datos (`confirmada` salta este último). */
  async function guardar(nueva: string | null, confirmada = false) {
    if (nueva && fecha.minima && nueva < fecha.minima) return setAviso("pasada");
    if (nueva && !confirmada && diasSinDatos(fecha, nueva) > 0) return setAviso("sinDatos");
    setAviso(null);
    setGuardando(true);
    setError(null);
    try {
      const r = await cambiarFechaSistema(nueva);
      toast.ok(mensajeCambioFecha(r));
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
      {aviso === "pasada" && fecha.minima ? (
        <AvisoFechaPasada
          ultimoMovimiento={fecha.minima}
          onClose={() => {
            setAviso(null);
            setValor(null);
          }}
        />
      ) : null}
      {aviso === "sinDatos" ? (
        <AvisoSinDatos fecha={fecha} elegida={elegido} ocupado={guardando} onUsar={(f) => void guardar(f, true)} onClose={() => setAviso(null)} />
      ) : null}
      <p className="hint" style={{ margin: "10px 0 0" }}>
        Con datos históricos, «hoy» es el día siguiente al último movimiento cargado. Al cambiarla se recalculan la proyección de la semana y las alertas.
        No puede ser futura ni anterior al último movimiento.
      </p>
    </div>
  );
}

type Tipo = "ventas" | "compras" | "mermas";
/** Último día cargado de cada tipo (para recortar el archivo antes de enviarlo). */
const ULTIMO: Record<Tipo, (f: ConfigFecha) => string | null> = {
  ventas: (f) => f.ultimos_movimientos.venta,
  compras: (f) => f.ultimos_movimientos.compra,
  mermas: (f) => f.ultimos_movimientos.merma,
};
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

  /** Arma el envío: cada archivo recortado a las filas del tramo (desde el último día cargado hasta la fecha límite). */
  async function cuerpo() {
    const c: Record<string, unknown> = { avanzar, hasta: hasta || null };
    const recorte: Partial<Record<Tipo, Recorte>> = {};
    for (const { t } of TIPOS) {
      if (!archivos[t]) continue;
      const texto = await archivos[t]!.text();
      const r = recortarCsv(texto, ULTIMO[t](fecha), hasta || null);
      c[t] = r ? r.texto : texto;
      if (r) recorte[t] = r.recorte;
    }
    c.recorte = recorte;
    return c;
  }

  // Atajos de tramo: desde el día siguiente al último cargado
  const inicioTramo = sumarDias(
    [fecha.ultimos_movimientos.venta, fecha.ultimos_movimientos.compra, fecha.ultimos_movimientos.merma]
      .filter((f): f is string => !!f)
      .reduce((m, f) => (f > m ? f : m), sumarDias(fecha.hoy, -1)),
    1,
  );
  const tope = (f: string) => (f > fecha.real ? fecha.real : f);
  const finDeMes = (iso: string) => {
    const [y, m] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  };
  const TRAMOS: { nombre: string; hasta: string }[] = [
    { nombre: "1 día", hasta: inicioTramo },
    { nombre: "1 semana", hasta: sumarDias(inicioTramo, 6) },
    { nombre: "Hasta fin de mes", hasta: finDeMes(inicioTramo) },
    { nombre: "30 días", hasta: sumarDias(inicioTramo, 29) },
  ].map((x) => ({ ...x, hasta: tope(x.hasta) }));

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
      if (r.data.fecha_sistema.nueva) avisarCambioFecha();
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
        archivo completo y cargarlo por tramos (solo se envía el tramo elegido). Se acepta el CSV de Excel (separador «;» y coma decimal) o con comas.
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
        {TRAMOS.map((x) => (
          <Button key={x.nombre} size="sm" disabled={!!ocupado} onClick={() => { setHasta(x.hasta); invalidar(); }}>
            {x.nombre}
          </Button>
        ))}
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
          {revision.advertencias.length ? (
            <details className="carga-lista">
              <summary>
                {revision.total_advertencias} {revision.total_advertencias === 1 ? "faltante" : "faltantes"} por redondeo del pesaje (hasta 0,5 kg), cubiertos por
                la compra siguiente
                {revision.kg_ajustados ? ` · ${fmtNum(revision.kg_ajustados, 2)} kg sin cubrir al final: ese stock queda en 0` : ""}
              </summary>
              <ul>
                {revision.advertencias.map((a) => (
                  <li key={`${a.tipo}-${a.linea}-${a.mensaje}`}>{a.linea ? <b>{a.tipo}, línea {a.linea}: </b> : null}{a.mensaje}</li>
                ))}
              </ul>
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
      {fecha.origen !== "real" ? <DeshacerMovimientos fecha={fecha} onCambio={onCambio} /> : null}
    </div>
  );
}

interface RevisionDeshacer {
  valido: boolean;
  desde: string;
  fecha_sistema: { actual: string; nueva: string };
  tipos: Record<Tipo, { movimientos: number; cantidad: number; desde: string | null; hasta: string | null }>;
  total: number;
  alertas: { borradas: number; reabiertas: number };
  stock: { producto: string; unidad: string; antes: number; despues: number }[];
  advertencias: string[];
  errores_generales: string[];
}

/**
 * Deshace ventas, compras y mermas desde una fecha (solo con fecha de referencia), para volver a mostrar una carga CSV
 * en una demostración: el stock vuelve a como estaba ese día y la fecha del sistema retrocede a esa fecha.
 */
function DeshacerMovimientos({ fecha, onCambio }: { fecha: ConfigFecha; onCambio: () => void }) {
  const toast = useToast();
  const [desde, setDesde] = useState(() => sumarDias(fecha.hoy, -7));
  const [revision, setRevision] = useState<RevisionDeshacer | null>(null);
  const [ocupado, setOcupado] = useState<null | "revisar" | "deshacer">(null);
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revisar() {
    setOcupado("revisar");
    setError(null);
    try {
      setRevision((await api.post<{ data: RevisionDeshacer }>("/import/deshacer/validar", { desde })).data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOcupado(null);
    }
  }

  async function deshacer() {
    setOcupado("deshacer");
    setError(null);
    try {
      const r = await api.post<{ data: RevisionDeshacer & { evaluacion: Evaluacion | null } }>("/import/deshacer", { desde });
      const ev = r.data.evaluacion;
      toast.ok(
        `Deshechos ${r.data.total} movimientos · fecha del sistema: ${fmtFecha(r.data.desde)}` +
          (ev ? ` · alertas: ${ev.creadas} nuevas, ${ev.cerradas} cerradas` : ""),
      );
      setConfirmar(false);
      setRevision(null);
      avisarCambioFecha();
      onCambio();
    } catch (e) {
      setConfirmar(false);
      setError(errorMessage(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <details className="carga-lista" style={{ marginTop: 16 }}>
      <summary>Deshacer movimientos desde una fecha (para repetir una carga en una demostración)</summary>
      <p className="hint" style={{ margin: "8px 0 10px" }}>
        Borra las ventas, compras y mermas desde el día elegido (incluido), devuelve el stock a como estaba ese día, quita las alertas creadas desde
        entonces y deja la fecha del sistema en ese día. Después puedes volver a subir los mismos archivos. Solo está disponible con fecha de
        referencia.
      </p>
      <div className="row-actions" style={{ flexWrap: "wrap", alignItems: "center" }}>
        <label className="hint" htmlFor="deshacer-desde">Desde (incluido)</label>
        <input
          id="deshacer-desde"
          className="input surface"
          type="date"
          style={{ height: 32, width: "auto" }}
          value={desde}
          max={fecha.hoy}
          onChange={(e) => {
            setDesde(e.target.value);
            setRevision(null);
            setError(null);
          }}
        />
        <Button size="sm" disabled={!desde || !!ocupado} loading={ocupado === "revisar"} onClick={() => void revisar()}>Revisar</Button>
        <Button size="sm" variant="danger" disabled={!revision?.valido || !!ocupado} onClick={() => setConfirmar(true)}>
          {revision?.valido ? `Deshacer ${revision.total} movimientos` : "Deshacer"}
        </Button>
      </div>
      {error ? <div className="form-err" role="alert" style={{ marginTop: 10 }}>{error}</div> : null}
      {revision ? (
        revision.valido ? (
          <div className="callout info" role="status" style={{ marginTop: 10 }}>
            <span>
              Se borrarán {revision.tipos.ventas.movimientos} ventas ({fmtNum(revision.tipos.ventas.cantidad)} kg), {revision.tipos.compras.movimientos}{" "}
              compras ({fmtNum(revision.tipos.compras.cantidad)} kg) y {revision.tipos.mermas.movimientos} mermas ({fmtNum(revision.tipos.mermas.cantidad)} kg)
              desde el {fmtFecha(revision.desde)}; cambia el stock de {revision.stock.length} productos y {revision.alertas.borradas} alertas se quitan
              {revision.alertas.reabiertas ? ` (${revision.alertas.reabiertas} vuelven a quedar activas)` : ""}. La fecha del sistema pasará del{" "}
              {fmtFecha(revision.fecha_sistema.actual)} al <b>{fmtFecha(revision.fecha_sistema.nueva)}</b>.
            </span>
          </div>
        ) : (
          <div className="callout err" role="alert" style={{ marginTop: 10 }}>
            <span>{revision.errores_generales.join(" ")}</span>
          </div>
        )
      ) : null}
      {revision?.valido && revision.advertencias.length ? (
        <ul className="carga-lista">
          {revision.advertencias.map((a) => <li key={a}>{a} Si necesitas que cuadre exacto, prueba otro día.</li>)}
        </ul>
      ) : null}
      {confirmar && revision ? (
        <ConfirmarModal
          titulo="¿Deshacer los movimientos?"
          confirmar={`Deshacer ${revision.total} movimientos`}
          peligro
          ocupado={ocupado === "deshacer"}
          onConfirmar={() => void deshacer()}
          onClose={() => setConfirmar(false)}
        >
          Se borrarán <b>{revision.total}</b> ventas, compras y mermas desde el <b>{fmtFecha(revision.desde)}</b> y el stock volverá a como estaba ese día.
          No se puede revertir, salvo volviendo a cargar los archivos. El cambio lo ven todos los usuarios.
        </ConfirmarModal>
      ) : null}
    </details>
  );
}
