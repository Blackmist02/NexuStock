"use client";

import { useEffect, useState } from "react";
import { descartarRestablecida, reintentarConexion, reportarFallo, sondear, reportarOk, useConexion } from "@/lib/conexion";

/**
 * Vigila la conexión (sin dibujar nada): eventos del navegador, chequeo periódico mientras todo va bien
 * y reintentos con espera creciente mientras no hay conexión.
 */
export function ConexionMonitor() {
  const { enLinea } = useConexion();

  // Eventos del navegador y comprobación inmediata al abrir la app (indicador «Sistema en línea»).
  useEffect(() => {
    if (!navigator.onLine) reportarFallo();
    else void reintentarConexion();
    const alCaer = () => reportarFallo();
    const alVolver = () => void reintentarConexion();
    window.addEventListener("offline", alCaer);
    window.addEventListener("online", alVolver);
    return () => {
      window.removeEventListener("offline", alCaer);
      window.removeEventListener("online", alVolver);
    };
  }, []);

  // Con conexión: chequeo liviano cada 30 s (solo con la pestaña visible) para detectar cortes silenciosos.
  useEffect(() => {
    if (!enLinea) return;
    let activo = true;
    const chequear = () => {
      if (document.visibilityState !== "visible") return;
      void sondear().then((ok) => {
        if (activo && !ok) reportarFallo();
      });
    };
    const id = setInterval(chequear, 30_000);
    document.addEventListener("visibilitychange", chequear);
    return () => {
      activo = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", chequear);
    };
  }, [enLinea]);

  // Sin conexión: reintenta sola (3 s, 4.5 s, 6.7 s… hasta 20 s).
  useEffect(() => {
    if (enLinea) return;
    let activo = true;
    let espera = 3000;
    let timer: ReturnType<typeof setTimeout>;
    const intentar = async () => {
      const ok = await sondear();
      if (!activo) return;
      if (ok) {
        reportarOk();
        return;
      }
      espera = Math.min(espera * 1.5, 20_000);
      timer = setTimeout(() => void intentar(), espera);
    };
    timer = setTimeout(() => void intentar(), espera);
    return () => {
      activo = false;
      clearTimeout(timer);
    };
  }, [enLinea]);

  return null;
}

/** Indicador compacto del estado del sistema: comprobando, en línea o sin conexión. */
export function EstadoSistema({ className }: { className?: string }) {
  const { enLinea, comprobado, causa } = useConexion();
  const texto = !comprobado
    ? "Comprobando conexión…"
    : enLinea
      ? "Sistema en línea"
      : causa === "red"
        ? "Sin internet · datos guardados"
        : "Servidor no disponible";
  return (
    <span className={["biz-status", className].filter(Boolean).join(" ")} role="status" aria-live="polite">
      <i className={!comprobado ? "biz-dot wait" : enLinea ? "biz-dot" : "biz-dot off"} aria-hidden="true" />
      {texto}
    </span>
  );
}

/**
 * Aviso amable y no bloqueante: ocupa su lugar arriba del contenido, no tapa nada y se puede cerrar.
 * Al volver la conexión muestra un momento «Conexión restablecida».
 * `contexto="acceso"` adapta el texto a las pantallas de inicio de sesión (sin datos guardados que mostrar).
 */
export function ConexionAviso({ contexto = "app" }: { contexto?: "app" | "acceso" }) {
  const { enLinea, restablecidaEn, episodio, causa } = useConexion();
  // El usuario puede cerrar el aviso; queda cerrado solo durante ese corte (un corte nuevo lo vuelve a mostrar).
  const [cerradoEpisodio, setCerradoEpisodio] = useState(0);
  const [probando, setProbando] = useState(false);

  useEffect(() => {
    if (restablecidaEn === null) return;
    const t = setTimeout(descartarRestablecida, 5000);
    return () => clearTimeout(t);
  }, [restablecidaEn]);

  if (enLinea && restablecidaEn !== null) {
    return (
      <div className="net-aviso ok" role="status" aria-live="polite">
        <span className="net-dot" aria-hidden="true" />
        <div className="net-txt">
          <strong>Conexión restablecida.</strong>{" "}
          {contexto === "app" ? "Estamos actualizando tu información." : "Ya puedes continuar."}
        </div>
      </div>
    );
  }

  if (enLinea || cerradoEpisodio === episodio) return null;

  const titulo = causa === "red" ? "Estás sin conexión a internet." : "No logramos comunicarnos con el servidor.";
  const detalle =
    contexto === "app"
      ? "No te preocupes: puedes seguir revisando las proyecciones y alertas de tu stock con la última información guardada en este dispositivo. Intentaremos reconectar solos y actualizaremos los datos cuando vuelva la conexión."
      : "No te preocupes: lo que escribiste no se pierde. Intentaremos reconectar solos y podrás continuar apenas vuelva la conexión.";

  return (
    <div className="net-aviso" role="status" aria-live="polite">
      <span className="net-dot off" aria-hidden="true" />
      <div className="net-txt">
        <strong>{titulo}</strong>{" "}
        {causa === "red" ? "Revisa tu wifi o cable de red. " : ""}
        {detalle}
      </div>
      <div className="net-acc">
        <button
          type="button"
          className="btn ghost sm"
          disabled={probando}
          onClick={() => {
            setProbando(true);
            void reintentarConexion().finally(() => setProbando(false));
          }}
        >
          {probando ? "Comprobando…" : "Reintentar ahora"}
        </button>
        <button type="button" className="net-x" aria-label="Cerrar aviso" onClick={() => setCerradoEpisodio(episodio)}>
          ×
        </button>
      </div>
    </div>
  );
}
