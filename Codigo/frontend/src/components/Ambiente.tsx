"use client";

import { useEffect } from "react";

/** Superficies que reflejan la luz del puntero (en el módulo del Dashboard la clase queda como «…__card…»). */
const SUPERFICIES = ".card, [class*='card'], .side";

/**
 * Fondo ambiental del vidrio (manchas de color fijas, ver glass.css) y reflejo que sigue al puntero:
 * fija --mx/--my en la superficie bajo el cursor. Vive en el layout raíz para no reiniciarse al navegar.
 */
export function Ambiente() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    let frame = 0;
    let ultimo: PointerEvent | null = null;
    const pintar = () => {
      frame = 0;
      const e = ultimo;
      if (!e || !(e.target instanceof Element)) return;
      const el = e.target.closest<HTMLElement>(SUPERFICIES);
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    const mover = (e: PointerEvent) => {
      ultimo = e;
      if (!frame) frame = requestAnimationFrame(pintar);
    };
    document.addEventListener("pointermove", mover, { passive: true });
    return () => {
      document.removeEventListener("pointermove", mover);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <div className="ambient" aria-hidden="true" />;
}
