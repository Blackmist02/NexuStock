"use client";

import { useEffect, ViewTransition, type ReactNode } from "react";
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

/**
 * Estructura común de las pantallas autenticadas: barra lateral + área principal.
 * Si no hay sesión válida redirige a /login.
 */
export function AppShell({ active, children, mainClassName }: AppShellProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="splash">
        <Loading texto="Verificando sesión…" />
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar active={active} />
      <main className="main">
        <ConexionAviso />
        {/* Al navegar, el contenido saliente se desvanece y el nuevo sube con desenfoque (glass.css, .nx-pagina) */}
        <ViewTransition enter="nx-pagina" exit="nx-pagina" default="none">
          <div className={["main-in", mainClassName].filter(Boolean).join(" ")}>{children}</div>
        </ViewTransition>
      </main>
    </div>
  );
}
