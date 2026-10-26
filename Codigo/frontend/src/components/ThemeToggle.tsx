"use client";

import { useSyncExternalStore } from "react";

type Theme = "oscuro" | "crema";
const STORAGE_KEY = "nx-theme";

// El tema vive en el atributo data-theme de <html> (lo fija un script antes del primer pintado).
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const leerTema = (): Theme => (document.documentElement.dataset.theme === "crema" ? "crema" : "oscuro");
const temaServidor = (): Theme => "oscuro";

/** Botón único (sol / luna) que alterna entre el tema oscuro y el crema y recuerda la elección. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, leerTema, temaServidor);

  function aplicar(next: Theme) {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* almacenamiento no disponible */
    }
  }

  /**
   * Cambia de tema con una transición suave: el tema nuevo "barre" la pantalla de izquierda a derecha
   * (View Transitions API, ver globals.css). Sin soporte → fundido de colores; con «reducir movimiento» → cambio directo.
   */
  function choose(next: Theme) {
    if (next === theme) return;
    const root = document.documentElement;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      aplicar(next);
      return;
    }
    if (typeof document.startViewTransition === "function") {
      // La clase limita el barrido al cambio de tema (las navegaciones tienen su propia transición)
      root.classList.add("nx-tema");
      const vt = document.startViewTransition(() => aplicar(next));
      void vt.finished.finally(() => root.classList.remove("nx-tema"));
      return;
    }
    root.classList.add("theme-fade");
    aplicar(next);
    window.setTimeout(() => root.classList.remove("theme-fade"), 500);
  }

  const siguiente: Theme = theme === "oscuro" ? "crema" : "oscuro";
  const etiqueta = siguiente === "crema" ? "Cambiar a tema crema" : "Cambiar a tema oscuro";

  return (
    <button type="button" className="theme-toggle" data-theme-toggle aria-label={etiqueta} title={etiqueta} onClick={() => choose(siguiente)}>
      {/* En tema oscuro se muestra el sol (lleva a crema); en tema crema, la luna (lleva a oscuro). */}
      <svg className="ico ico-sol" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      <svg className="ico ico-luna" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}
