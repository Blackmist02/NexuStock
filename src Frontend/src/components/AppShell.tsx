"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sidebar, type NavKey } from "./Sidebar";
import { useAuth } from "@/lib/auth";
import { ConexionAviso } from "./ConexionAviso";
import { Loading } from "./ui/States";

type AppShellProps = {
  active: NavKey;
  children: ReactNode;
  mainClassName?: string;
};

const MENU_KEY = "nx-menu-oculto";
// Mismo corte que views.css: en teléfono y tableta el menú es un panel que se abre sobre la pantalla
const MOVIL = "(max-width: 900px)";

function leerMenuOculto() {
  try {
    return typeof window !== "undefined" && localStorage.getItem(MENU_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Estructura común de las pantallas autenticadas: barra lateral + área principal.
 * El botón de menú (hamburguesa) oculta la barra en computador para usar la pantalla completa (se recuerda la
 * elección) y en teléfono abre el menú como panel lateral.
 * Si no hay sesión válida redirige a /login.
 */
export function AppShell({ active, children, mainClassName }: AppShellProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [oculto, setOculto] = useState(leerMenuOculto);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Panel abierto en teléfono: Escape lo cierra
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto]);

  function alternarMenu() {
    if (window.matchMedia(MOVIL).matches) {
      setAbierto((a) => !a);
      return;
    }
    const nuevo = !oculto;
    setOculto(nuevo);
    try {
      localStorage.setItem(MENU_KEY, nuevo ? "1" : "0");
    } catch {
      /* almacenamiento no disponible */
    }
  }

  if (loading || !user) {
    return (
      <div className="splash">
        <Loading texto="Verificando sesión…" />
      </div>
    );
  }

  return (
    <div className={["app", oculto && "menu-oculto", abierto && "menu-abierto"].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="menu-btn"
        onClick={alternarMenu}
        aria-controls="menu-lateral"
        aria-expanded={abierto || !oculto}
        aria-label={abierto || !oculto ? "Ocultar menú" : "Mostrar menú"}
        title={abierto || !oculto ? "Ocultar menú" : "Mostrar menú"}
      >
        <span />
        <span />
        <span />
      </button>
      <Sidebar active={active} onNavegar={() => setAbierto(false)} />
      {abierto ? <div className="side-scrim" onClick={() => setAbierto(false)} aria-hidden="true" /> : null}
      <main className={["main", mainClassName].filter(Boolean).join(" ")}>
        <ConexionAviso />
        {children}
      </main>
    </div>
  );
}
