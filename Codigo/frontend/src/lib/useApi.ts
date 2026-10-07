"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, esSinConexion } from "./api";
import { guardarCache, leerCache } from "./cacheLocal";
import { alVolverConexion } from "./conexion";

type Query = Record<string, string | number | boolean | null | undefined>;

export interface ApiOpciones {
  /**
   * Guarda la última respuesta en este dispositivo y, si se corta la conexión, la sigue mostrando
   * (marcada como `obsoleto`) en vez de un error.
   */
  resguardo?: boolean;
}

export interface ApiState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** true si `data` viene del resguardo local / de una carga anterior porque no hay conexión. */
  obsoleto: boolean;
  /** true si falló por falta de conexión y no hay nada guardado que mostrar. */
  sinConexion: boolean;
  /** Vuelve a pedir los datos (conserva los anteriores mientras tanto). */
  reload: () => Promise<void>;
}

interface Resultado<T> {
  key: string;
  data?: T;
  error: string | null;
  obsoleto: boolean;
  sinConexion: boolean;
}

/**
 * GET con estado de carga/error. Se vuelve a pedir cuando cambian la ruta o la query,
 * y automáticamente cuando vuelve la conexión tras un corte.
 * Pasa `path = null` para no pedir nada todavía.
 */
export function useApi<T>(path: string | null, query?: Query, opciones?: ApiOpciones): ApiState<T> {
  const queryKey = JSON.stringify(query ?? {});
  const key = path === null ? null : `${path}?${queryKey}`;
  const resguardo = !!opciones?.resguardo;
  const [res, setRes] = useState<Resultado<T> | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let cancelado = false;
    const k = `${path}?${queryKey}`;
    api
      .get<T>(path, JSON.parse(queryKey) as Query)
      .then((data) => {
        if (cancelado) return;
        if (resguardo) guardarCache(k, data);
        setRes({ key: k, data, error: null, obsoleto: false, sinConexion: false });
      })
      .catch((e: unknown) => {
        if (cancelado) return;
        const sinRed = esSinConexion(e);
        setRes((prev) => {
          const previo = prev?.key === k ? prev.data : undefined;
          if (sinRed) {
            // Sin conexión: se muestra lo último que se tenga (carga anterior o resguardo local), sin error.
            const data = previo ?? (resguardo ? leerCache<T>(k)?.data : undefined);
            return { key: k, data, error: null, obsoleto: data !== undefined, sinConexion: data === undefined };
          }
          return { key: k, data: previo, error: errorMessage(e), obsoleto: false, sinConexion: false };
        });
      });
    return () => {
      cancelado = true;
    };
  }, [path, queryKey, resguardo, intento]);

  // Al volver la conexión, se piden de nuevo los datos para reemplazar los guardados.
  useEffect(() => alVolverConexion(() => setIntento((n) => n + 1)), []);

  const reload = useCallback(async () => setIntento((n) => n + 1), []);

  const vigente = res !== null && res.key === key;
  return {
    data: vigente ? res.data : undefined,
    error: vigente ? res.error : null,
    loading: key !== null && !vigente,
    obsoleto: vigente ? res.obsoleto : false,
    sinConexion: vigente ? res.sinConexion : false,
    reload,
  };
}
