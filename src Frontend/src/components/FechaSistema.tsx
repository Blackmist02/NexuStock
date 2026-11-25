"use client";

import { useState } from "react";
import { Button, Field } from "./ui/Field";
import { Modal } from "./ui/Modal";
import { useToast } from "./ui/Toast";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { cambiarFechaSistema, mensajeCambioFecha } from "@/lib/fechaSistema";
import { fmtFecha } from "@/lib/format";
import { puede } from "@/lib/permisos";
import { useApi } from "@/lib/useApi";
import type { ConfigFecha, ConfigNegocio } from "@/lib/tipos";

const sumarDias = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** "2024-09-30" → "30 sept 2024" */
const fechaMedia = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
};

/** Día siguiente al último movimiento cargado (sin pasar de hoy): el «hoy» natural de los datos históricos. */
const siguienteAlUltimo = (f: ConfigFecha) => (f.minima ? [sumarDias(f.minima, 1), f.real].sort()[0] : null);

const difDias = (a: string, b: string) => {
  const ms = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((ms(a) - ms(b)) / 86_400_000);
};

/** Días completos sin movimientos cargados entre el último movimiento y la fecha `nueva` (0 si no queda hueco). */
export const diasSinDatos = (f: ConfigFecha, nueva: string) => (f.minima ? Math.max(0, difDias(nueva, f.minima) - 1) : 0);

/** Fecha del sistema vigente (de /config, la misma consulta que usa la barra lateral). */
function useFechaSistema() {
  const { data } = useApi<{ data: ConfigNegocio }>("/config", undefined, { resguardo: true });
  return data?.data.fecha;
}

/**
 * Guarda la fecha con aviso y devuelve true si se pudo. `pendiente` es la fecha pedida (null = real) mientras el
 * servidor recalcula proyecciones y alertas, que puede tardar varios segundos con la base remota.
 */
function useCambiarFecha() {
  const toast = useToast();
  const [pendiente, setPendiente] = useState<{ fecha: string | null } | null>(null);
  async function cambiar(fecha: string | null) {
    setPendiente({ fecha });
    try {
      toast.ok(mensajeCambioFecha(await cambiarFechaSistema(fecha)));
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setPendiente(null);
    }
  }
  return { cambiar, ocupado: pendiente !== null, pendiente };
}

/**
 * Interruptor de la barra lateral: «hoy» es la fecha de referencia (datos históricos) o la fecha real.
 * Al volver a «Referencia» se usa la última fecha de referencia guardada.
 */
export function FechaSistemaToggle() {
  const { user } = useAuth();
  const fecha = useFechaSistema();
  const { cambiar, ocupado, pendiente } = useCambiarFecha();
  const [aviso, setAviso] = useState<null | "pasada" | "sinDatos">(null);
  if (!fecha) return null;

  // Mientras se guarda, el interruptor ya muestra la opción elegida
  const enReal = pendiente ? pendiente.fecha === null : fecha.origen === "real";
  const destino = fecha.ultima_referencia ?? siguienteAlUltimo(fecha);
  // Si se registraron movimientos después de esa fecha (p. ej. trabajando con la fecha real), ya no se puede volver a ella
  const bloqueada = !destino || (!!fecha.minima && destino < fecha.minima);
  const editable = puede(user?.rol, "fecha_sistema");

  return (
    <div className="fecha-sis">
      <div className="fecha-sis-lbl">Fecha del sistema</div>
      {editable ? (
        <div className="seg" role="group" aria-label="Fecha del sistema">
          <button
            type="button"
            aria-pressed={!enReal}
            disabled={ocupado}
            title={destino && !bloqueada ? `Usar ${fmtFecha(destino)}` : undefined}
            onClick={() => {
              if (fecha.origen !== "real") return;
              if (bloqueada) setAviso("pasada");
              else if (destino && diasSinDatos(fecha, destino) > 0) setAviso("sinDatos");
              else if (destino) void cambiar(destino);
            }}
          >
            Referencia
          </button>
          <button type="button" aria-pressed={enReal} disabled={ocupado} onClick={() => fecha.origen !== "real" && void cambiar(null)}>
            Real
          </button>
        </div>
      ) : null}
      {pendiente ? (
        <div className="fecha-sis-val fecha-sis-pend" role="status">
          <span className="spin" aria-hidden="true" />
          <span>Recalculando alertas…</span>
        </div>
      ) : (
        <div className="fecha-sis-val">
          {fechaMedia(fecha.hoy)}
          {editable ? null : <span> · {enReal ? "fecha real" : "referencia"}</span>}
        </div>
      )}
      {aviso === "pasada" && fecha.minima ? <AvisoFechaPasada ultimoMovimiento={fecha.minima} onClose={() => setAviso(null)} /> : null}
      {aviso === "sinDatos" && destino ? (
        <AvisoSinDatos
          fecha={fecha}
          elegida={destino}
          onUsar={(f) => {
            setAviso(null);
            void cambiar(f);
          }}
          onClose={() => setAviso(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Fecha vigente en la barra superior de todas las vistas. Para administrador y TI abre la ventana para cambiarla
 * (el cambio rige para toda la app); para el resto es solo un indicador de qué «hoy» usa el sistema.
 */
export function FechaBoton() {
  const { user } = useAuth();
  const fecha = useFechaSistema();
  const [abierto, setAbierto] = useState(false);
  if (!fecha) return null;
  const contenido = (
    <>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="12" height="11" rx="2" />
        <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" />
      </svg>
      {fechaMedia(fecha.hoy)}
      {fecha.origen === "real" ? null : <span className="fecha-btn-tag">ref.</span>}
    </>
  );
  if (!puede(user?.rol, "fecha_sistema")) {
    const cual = fecha.origen === "real" ? "la fecha real" : "una fecha de referencia";
    return (
      <span className="btn ghost sm fecha-btn fecha-btn-fija" title={`El sistema trabaja con ${cual}. Solo Administrador o TI pueden cambiarla.`}>
        {contenido}
      </span>
    );
  }
  return (
    <>
      <Button size="sm" className="fecha-btn" onClick={() => setAbierto(true)} title="Cambiar la fecha del sistema">
        {contenido}
      </Button>
      {abierto ? <FechaModal fecha={fecha} onClose={() => setAbierto(false)} /> : null}
    </>
  );
}

function FechaModal({ fecha, onClose }: { fecha: ConfigFecha; onClose: () => void }) {
  const { cambiar, ocupado } = useCambiarFecha();
  const [valor, setValor] = useState(fecha.hoy);
  const [aviso, setAviso] = useState<null | "pasada" | "sinDatos">(null);
  const siguiente = siguienteAlUltimo(fecha);
  const fueraDeRango = !valor || valor > fecha.real;
  const anteriorALosDatos = !!fecha.minima && !!valor && valor < fecha.minima;

  /** Guarda la fecha; `confirmada` salta el aviso de días sin datos (ya se mostró). */
  async function guardar(nueva: string | null, confirmada = false) {
    if (nueva && anteriorALosDatos) return setAviso("pasada");
    if (nueva && !confirmada && diasSinDatos(fecha, nueva) > 0) return setAviso("sinDatos");
    setAviso(null);
    if (await cambiar(nueva)) onClose();
  }

  if (aviso === "pasada" && fecha.minima) {
    return (
      <AvisoFechaPasada
        ultimoMovimiento={fecha.minima}
        onClose={() => {
          setAviso(null);
          setValor(siguiente ?? fecha.hoy);
        }}
      />
    );
  }
  if (aviso === "sinDatos") {
    return <AvisoSinDatos fecha={fecha} elegida={valor} ocupado={ocupado} onUsar={(f) => void guardar(f, true)} onClose={() => setAviso(null)} />;
  }

  return (
    <Modal
      titulo="Fecha del sistema"
      subtitulo="«Hoy» para proyecciones, alertas y sugerencias de compra. Cambia para todo el equipo."
      onClose={onClose}
      ocupado={ocupado}
      ancho={440}
      pie={
        <>
          <Button onClick={onClose} disabled={ocupado}>Cancelar</Button>
          <Button variant="primary" loading={ocupado} disabled={fueraDeRango || valor === fecha.referencia} onClick={() => void guardar(valor)}>
            {ocupado ? "Recalculando alertas…" : "Usar esta fecha"}
          </Button>
        </>
      }
    >
      <Field label="Fecha de referencia" htmlFor="fecha-ref">
        <input
          id="fecha-ref"
          className="input"
          type="date"
          value={valor}
          max={fecha.real}
          onChange={(e) => setValor(e.target.value)}
        />
      </Field>
      <div className="row-actions" style={{ flexWrap: "wrap", marginTop: 10 }}>
        {siguiente ? (
          <Button size="sm" disabled={ocupado || valor === siguiente} onClick={() => setValor(siguiente)}>
            Día siguiente a los datos ({fmtFecha(siguiente)})
          </Button>
        ) : null}
        {fecha.origen !== "real" ? (
          <Button size="sm" disabled={ocupado} onClick={() => void guardar(null)}>Usar la fecha real</Button>
        ) : null}
      </div>
      <p className="hint" style={{ margin: "12px 0 0" }}>
        {fecha.minima ? `Hay ventas y compras registradas hasta el ${fmtFecha(fecha.minima)}: elige ese día o uno posterior.` : "Aún no hay movimientos cargados."}{" "}
        No puede ser posterior a hoy ({fmtFecha(fecha.real)}).
      </p>
    </Modal>
  );
}

/**
 * Aviso al elegir una fecha anterior a los movimientos ya registrados. Lo leen administradores del local, no TI:
 * explica sin tecnicismos por qué no se hace y qué usar en su lugar.
 */
export function AvisoFechaPasada({ ultimoMovimiento, onClose }: { ultimoMovimiento: string; onClose: () => void }) {
  return (
    <Modal
      titulo="Mejor no volver a una fecha pasada"
      subtitulo={`El sistema ya tiene ventas y compras registradas hasta el ${fmtFecha(ultimoMovimiento)}. Volver antes de ese día traería estos problemas:`}
      onClose={onClose}
      ancho={500}
      pie={<Button variant="primary" onClick={onClose}>Entendido, elijo otra fecha</Button>}
    >
      <ul className="aviso-lista">
        <li>
          <b>El stock dejaría de cuadrar.</b> Lo que hay en la cámara hoy ya descuenta todo lo vendido hasta el {fmtFecha(ultimoMovimiento)}. Si el
          sistema «vuelve atrás», esas ventas quedarían como si todavía no hubieran pasado y los kilos no tendrían sentido.
        </li>
        <li>
          <b>Se desordenaría el historial.</b> Cualquier venta o compra que se anote quedaría con una fecha equivocada, mezclada con las que ya
          existen.
        </li>
        <li>
          <b>Todo el equipo vería alertas falsas.</b> Las alertas y sugerencias de compra se recalcularían con datos viejos, y el cambio no es solo
          para ti: lo ven todos los que usan NexuStock.
        </li>
        <li>
          <b>Las predicciones parecerían mejores de lo que son.</b> El sistema aprendió con las ventas de 2022 y 2023, así que en esas fechas
          «ya se sabe las respuestas». Es como evaluar a alguien con la misma prueba que estudió.
        </li>
      </ul>
      <p className="hint" style={{ margin: "14px 0 0" }}>
        ¿Quieres revisar cómo fueron las ventas de una fecha anterior? Usa <b>Historial</b>: ahí puedes filtrar por fechas sin cambiar nada.
        Si necesitas una demostración con datos antiguos, pídele a TI que prepare una copia aparte del sistema.
      </p>
    </Modal>
  );
}

/**
 * Aviso al elegir una fecha de referencia que deja días sin ventas ni compras cargadas: el sistema los toma como días
 * sin venta. Permite seguir (el local pudo estar cerrado), pero propone el día siguiente a los datos.
 */
export function AvisoSinDatos({
  fecha,
  elegida,
  ocupado,
  onUsar,
  onClose,
}: {
  fecha: ConfigFecha;
  elegida: string;
  ocupado?: boolean;
  onUsar: (fecha: string) => void;
  onClose: () => void;
}) {
  const siguiente = siguienteAlUltimo(fecha)!;
  const dias = diasSinDatos(fecha, elegida);
  const ultimo = fmtFecha(fecha.minima);
  return (
    <Modal
      titulo="Faltan ventas por cargar"
      subtitulo={`Entre el ${fmtFecha(siguiente)} y el ${fmtFecha(sumarDias(elegida, -1))} (${dias} ${dias === 1 ? "día" : "días"}) no hay ventas ni compras registradas. Si usas el ${fmtFecha(elegida)}:`}
      onClose={onClose}
      ocupado={ocupado}
      ancho={500}
      pie={
        <>
          <Button disabled={ocupado} onClick={() => onUsar(elegida)}>Usar igual el {fmtFecha(elegida)}</Button>
          <Button variant="primary" loading={ocupado} onClick={() => onUsar(siguiente)}>Usar el {fmtFecha(siguiente)}</Button>
        </>
      }
    >
      <ul className="aviso-lista">
        <li>
          <b>NexuStock va a creer que no vendiste nada esos días.</b> En los gráficos las ventas aparecerán en cero.
        </li>
        <li>
          <b>Las predicciones van a salir más bajas de lo normal,</b> porque el sistema mira las últimas semanas para calcular cuánto se va a
          vender.
        </li>
        <li>
          <b>Las alertas y sugerencias de compra se calcularán con esas ventas en cero,</b> y las verá todo el equipo.
        </li>
        <li>
          <b>El stock no se va a mover:</b> seguirá siendo el que había al cierre del {ultimo}.
        </li>
      </ul>
      <p className="hint" style={{ margin: "14px 0 0" }}>
        Si el local sí vendió esos días, primero carga esas ventas en <b>Configuración → Carga de datos (CSV)</b> y marca «Mover la fecha del
        sistema al día siguiente de la carga». Si el local estuvo cerrado, puedes usar la fecha igual.
      </p>
    </Modal>
  );
}
