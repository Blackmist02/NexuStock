"use client";

import Link from "next/link";
import { Logo } from "./Logo";
import { useAuth } from "@/lib/auth";
import { useConexion } from "@/lib/conexion";
import { ROL_LABEL } from "@/lib/permisos";

/** Vistas disponibles hoy. Las demás (inventario, predicción, historial…) se irán agregando aquí. */
export const NAV_ITEMS = [{ key: "dashboard", href: "/dashboard", label: "Dashboard" }] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

export function Sidebar({ active }: { active: NavKey }) {
  const { user, logout } = useAuth();
  const { enLinea } = useConexion();
  return (
    <aside className="side">
      <div className="brand">
        <Link href="/dashboard" aria-label="NexuStock — ir al Dashboard">
          <Logo width={132} height={48} />
        </Link>
      </div>
      <nav className="nav" aria-label="Principal">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={item.key === active ? "on" : undefined}
            aria-current={item.key === active ? "page" : undefined}
          >
            <span className="dot" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="biz">
        <span className="biz-status">
          <i className={enLinea ? "biz-dot" : "biz-dot off"} />
          {enLinea ? "Sistema en línea" : "Sin conexión · datos guardados"}
        </span>
        {user ? (
          <div className="who">
            {user.nombre}
            <div style={{ color: "var(--ink-muted)", fontWeight: 400 }}>{ROL_LABEL[user.rol]}</div>
          </div>
        ) : null}
        <button type="button" className="logout" onClick={() => void logout()}>
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
