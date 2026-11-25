"use client";

import { useEffect, type RefObject } from "react";

/**
 * En el teléfono las tablas `.tbl` se muestran como tarjetas (ver movil.css): cada celda lleva delante el nombre de su
 * columna. Este hook copia el texto de cada encabezado (`<th>`) al atributo `data-label` de las celdas de esa columna,
 * respetando `colSpan`, para todas las tablas dentro del contenedor y las que aparezcan después (paginación, filtros).
 * Una celda que ocupa varias columnas (p. ej. «Sin datos») queda sin etiqueta. `activo` indica que el contenedor ya está
 * montado (AppShell muestra primero «Verificando sesión…» y el <main> aparece después).
 */
export function useEtiquetasTabla(contenedor: RefObject<HTMLElement | null>, activo = true) {
  useEffect(() => {
    const raiz = contenedor.current;
    if (!activo || !raiz) return;

    const etiquetar = () => {
      raiz.querySelectorAll<HTMLTableElement>("table.tbl, table.tbl-movil").forEach((tabla) => {
        const encabezados: string[] = [];
        tabla.querySelectorAll<HTMLTableCellElement>("thead tr:last-child th").forEach((th) => {
          const texto = (th.textContent ?? "").replace(/\s+/g, " ").trim();
          for (let i = 0; i < (th.colSpan || 1); i++) encabezados.push(texto);
        });
        if (!encabezados.length) return;
        tabla.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((fila) => {
          let col = 0;
          for (const celda of Array.from(fila.cells)) {
            const span = celda.colSpan || 1;
            const etiqueta = span > 1 ? "" : (encabezados[col] ?? "");
            if (celda.getAttribute("data-label") !== etiqueta) celda.setAttribute("data-label", etiqueta);
            col += span;
          }
        });
      });
    };

    etiquetar();
    // Solo cambios de nodos: los atributos que pone este hook no vuelven a disparar el observador.
    let pendiente = 0;
    const observador = new MutationObserver(() => {
      cancelAnimationFrame(pendiente);
      pendiente = requestAnimationFrame(etiquetar);
    });
    observador.observe(raiz, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(pendiente);
      observador.disconnect();
    };
  }, [contenedor, activo]);
}
