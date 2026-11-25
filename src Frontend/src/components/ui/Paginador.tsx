"use client";

import { useState } from "react";

/**
 * Divide una lista en páginas. La página vuelve a la primera cuando cambia `reinicio`
 * (p. ej. los filtros o la búsqueda) y se ajusta sola si la lista se achica (al atender una alerta).
 */
export function usePaginado<T>(items: readonly T[], porPagina: number, reinicio: unknown = null) {
  const [estado, setEstado] = useState({ pagina: 0, reinicio });
  // Reinicio durante el render (patrón recomendado por React en lugar de un efecto)
  if (!Object.is(estado.reinicio, reinicio)) setEstado({ pagina: 0, reinicio });
  const paginas = Math.max(1, Math.ceil(items.length / porPagina));
  const pagina = Math.min(estado.reinicio === reinicio ? estado.pagina : 0, paginas - 1);
  const desde = pagina * porPagina;
  return {
    visibles: items.slice(desde, desde + porPagina),
    pagina,
    paginas,
    desde,
    hasta: Math.min(desde + porPagina, items.length),
    total: items.length,
    irA: (p: number) => setEstado({ pagina: Math.max(0, Math.min(p, paginas - 1)), reinicio }),
  };
}

type PaginadorProps = Pick<ReturnType<typeof usePaginado>, "pagina" | "paginas" | "desde" | "hasta" | "total" | "irA"> & {
  /** Nombre de lo que se lista, en plural: «productos», «alertas»… */
  unidad?: string;
};

/** Controles de página bajo una tabla. No se muestra si todo cabe en una sola página. */
export function Paginador({ pagina, paginas, desde, hasta, total, irA, unidad = "filas" }: PaginadorProps) {
  if (paginas <= 1) return null;
  return (
    <nav className="paginador" aria-label={`Páginas de ${unidad}`}>
      <span className="paginador-txt">
        {desde + 1}–{hasta} de {total} {unidad}
      </span>
      <div className="paginador-btns">
        <button type="button" className="btn sm ghost" disabled={pagina === 0} onClick={() => irA(pagina - 1)}>
          ‹ Anterior
        </button>
        <span className="paginador-pag" aria-live="polite">
          {pagina + 1} / {paginas}
        </span>
        <button type="button" className="btn sm ghost" disabled={pagina >= paginas - 1} onClick={() => irA(pagina + 1)}>
          Siguiente ›
        </button>
      </div>
    </nav>
  );
}
