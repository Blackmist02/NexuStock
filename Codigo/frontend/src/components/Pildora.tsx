"use client";

import { useLayoutEffect, useRef } from "react";

/** Última posición de cada píldora (relativa a su contenedor); sobrevive al desmontaje del menú al navegar. */
const ultimas = new Map<string, { x: number; y: number; w: number; h: number }>();

function medir(el: HTMLElement) {
  const item = el.parentElement;
  const caja = item?.parentElement;
  if (!item || !caja) return null;
  const a = item.getBoundingClientRect();
  const b = caja.getBoundingClientRect();
  return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
}

/**
 * Píldora del ítem activo (menú lateral, pestañas): al cambiar de página se desliza desde la posición del ítem
 * anterior hasta el nuevo con un resorte (técnica FLIP sobre el elemento real, sin capas superpuestas).
 */
export function usePildora(grupo: string) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const antes = ultimas.get(grupo);
    const ahora = medir(el);
    if (antes && ahora && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const dx = antes.x - ahora.x;
      const dy = antes.y - ahora.y;
      if (dx || dy || antes.w !== ahora.w) {
        const easing = getComputedStyle(document.documentElement).getPropertyValue("--ease-spring").trim() || "ease-out";
        el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(${antes.w / ahora.w}, ${antes.h / ahora.h})` },
            { transform: "none" },
          ],
          { duration: 600, easing },
        );
      }
    }
    // Se guarda al desmontar: es la posición desde la que partirá la píldora de la página siguiente.
    return () => {
      const fin = medir(el);
      if (fin) ultimas.set(grupo, fin);
    };
  }, [grupo]);

  return ref;
}

/** Píldora de vidrio que se monta dentro del ítem activo. */
export function Pildora({ grupo }: { grupo: string }) {
  const ref = usePildora(grupo);
  return <span ref={ref} className="nav-pill" aria-hidden="true" />;
}
