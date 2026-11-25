"use client";

import { useState } from "react";
import { ApiClientError, errorMessage } from "@/lib/api";

/** Estado común de los formularios modales: guardando, error general y errores por campo devueltos por la API. */
export function useGuardar() {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});

  async function ejecutar<T>(accion: () => Promise<T>): Promise<T | undefined> {
    setEnviando(true);
    setError(null);
    try {
      const r = await accion();
      return r;
    } catch (e) {
      if (e instanceof ApiClientError && Object.keys(e.fieldErrors).length) setCampos(e.fieldErrors);
      else setError(errorMessage(e));
      return undefined;
    } finally {
      setEnviando(false);
    }
  }
  return { enviando, error, campos, setCampos, setError, ejecutar };
}
