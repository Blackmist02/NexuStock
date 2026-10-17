"use client";

import { useEffect, useState } from "react";

/** Devuelve `valor` solo después de que deja de cambiar durante `ms` (para búsquedas mientras se escribe). */
export function useDebounced<T>(valor: T, ms = 300): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}
