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

/** Alterna entre el tema Oscuro y el Crema y recuerda la elección. */
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
      document.startViewTransition(() => aplicar(next));
      return;
    }
    root.classList.add("theme-fade");
    aplicar(next);
    window.setTimeout(() => root.classList.remove("theme-fade"), 500);
  }

  return (
    <div className="theme-toggle" role="group" aria-label="Tema de color" data-theme-toggle>
      {(["oscuro", "crema"] as const).map((t) => (
        <button key={t} type="button" aria-pressed={theme === t} className={theme === t ? "on" : undefined} onClick={() => choose(t)}>
          {t === "oscuro" ? "Oscuro" : "Crema"}
        </button>
      ))}
    </div>
  );
}
