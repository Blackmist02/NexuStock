"use client";

import { useSyncExternalStore } from "react";

/**
 * Estado de la conexión con el servidor, compartido por toda la app.
 *
 * Se considera "sin conexión" cuando:
 *  - el navegador avisa que no hay red (evento `offline`),
 *  - una llamada a la API no llega al servidor (ver api.ts → reportarFallo), o
 *  - el chequeo periódico de /api/health falla.
 * Mientras no hay conexión se vuelve a probar sola con espera creciente; al volver, se avisa a quien
 * esté suscrito (useApi vuelve a pedir sus datos).
 */
export interface EstadoConexion {
  enLinea: boolean;
  /** Marca de tiempo (ms) del momento en que volvió la conexión; null si no acaba de volver. */
  restablecidaEn: number | null;
  /** Número de corte actual (sube con cada corte nuevo); sirve para recordar qué avisos ya cerró el usuario. */
  episodio: number;
}

let estado: EstadoConexion = { enLinea: true, restablecidaEn: null, episodio: 0 };
const oyentes = new Set<() => void>();
const alReconectar = new Set<() => void>();

function fijar(nuevo: EstadoConexion) {
  estado = nuevo;
  oyentes.forEach((f) => f());
}

export function reportarFallo() {
  if (estado.enLinea) fijar({ enLinea: false, restablecidaEn: null, episodio: estado.episodio + 1 });
}

export function reportarOk() {
  if (!estado.enLinea) {
    fijar({ ...estado, enLinea: true, restablecidaEn: Date.now() });
    alReconectar.forEach((f) => f());
  }
}

/** Oculta el aviso de «conexión restablecida». */
export function descartarRestablecida() {
  if (estado.restablecidaEn !== null) fijar({ ...estado, restablecidaEn: null });
}

/** Ejecuta `fn` cada vez que la conexión vuelve tras un corte. Devuelve la función para desuscribirse. */
export function alVolverConexion(fn: () => void): () => void {
  alReconectar.add(fn);
  return () => {
    alReconectar.delete(fn);
  };
}

const suscribir = (cb: () => void) => {
  oyentes.add(cb);
  return () => {
    oyentes.delete(cb);
  };
};
const instantanea = () => estado;
const SERVIDOR: EstadoConexion = { enLinea: true, restablecidaEn: null, episodio: 0 };
const instantaneaServidor = () => SERVIDOR;

export function useConexion(): EstadoConexion {
  return useSyncExternalStore(suscribir, instantanea, instantaneaServidor);
}

/** ¿Responde el servidor? Usa la ruta pública /api/health. */
export async function sondear(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(5000) });
    // 5xx = el servidor de la API no responde (el frontend devuelve 500/502 cuando no la alcanza).
    return res.status < 500;
  } catch {
    return false;
  }
}

/** Botón «Reintentar»: comprueba ahora mismo y actualiza el estado. */
export async function reintentarConexion(): Promise<boolean> {
  const ok = await sondear();
  if (ok) reportarOk();
  else reportarFallo();
  return ok;
}
