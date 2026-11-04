import { api } from "./api";
import { fmtFecha } from "./format";
import type { ConfigFecha } from "./tipos";

/**
 * Cambios de la fecha del sistema («hoy» de NexuStock), compartidos por toda la app: al cambiarla desde la barra
 * lateral, el Dashboard o Configuración, se avisa a los suscritos (useApi vuelve a pedir sus datos).
 */
export type Evaluacion = { evaluados: number; creadas: number; cerradas: number } | null;
export interface CambioFecha {
  fecha: ConfigFecha;
  evaluacion: Evaluacion;
}

const oyentes = new Set<() => void>();

/** Avisa que la fecha del sistema cambió (también la puede mover la carga de CSV). */
export function avisarCambioFecha() {
  oyentes.forEach((f) => f());
}

/** Ejecuta `fn` cada vez que cambia la fecha del sistema. Devuelve la función para desuscribirse. */
export function alCambiarFecha(fn: () => void): () => void {
  oyentes.add(fn);
  return () => {
    oyentes.delete(fn);
  };
}

/** Guarda la fecha de referencia (o null para usar la fecha real) y avisa a toda la app. */
export async function cambiarFechaSistema(fecha: string | null): Promise<CambioFecha> {
  const r = await api.put<{ data: CambioFecha }>("/config/fecha", { fecha });
  avisarCambioFecha();
  return r.data;
}

export function mensajeCambioFecha({ fecha, evaluacion: ev }: CambioFecha): string {
  const cual = fecha.origen === "real" ? "fecha real" : "fecha de referencia";
  return `Fecha del sistema: ${fmtFecha(fecha.hoy)} (${cual})${ev ? ` · alertas: ${ev.creadas} nuevas, ${ev.cerradas} cerradas` : ""}`;
}
