"use client";

import Link from "next/link";
import { Pildora } from "./Pildora";
import { Logo } from "./Logo";
import { useAuth } from "@/lib/auth";
import { useConexion } from "@/lib/conexion";
import { puede, ROL_LABEL } from "@/lib/permisos";
import { useApi } from "@/lib/useApi";
import type { ConfigNegocio } from "@/lib/tipos";

export const NAV_ITEMS = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard" },
  { key: "inventario", href: "/inventario", label: "Inventario" },
  { key: "alertas", href: "/alertas", label: "Alertas" },
  { key: "prediccion", href: "/prediccion", label: "Predicción" },
  { key: "historial", href: "/historial", label: "Historial" },
  { key: "configuracion", href: "/configuracion", label: "Configuración" },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

export function Sidebar({ active }: { active: NavKey }) {
  const { user, logout } = useAuth();
  const { enLinea } = useConexion();
  const { data: cfg } = useApi<{ data: ConfigNegocio }>("/config", undefined, { resguardo: true });
  const items = NAV_ITEMS.filter((i) => i.key !== "configuracion" || puede(user?.rol, "usuarios"));
  return (
    <aside className="side">
      <div className="brand">
        <Link href="/dashboard" aria-label="NexuStock — ir al Dashboard">
          <Logo width={132} height={48} />
        </Link>
      </div>
      <nav className="nav" aria-label="Principal">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={item.key === active ? "on" : undefined}
            aria-current={item.key === active ? "page" : undefined}
          >
            {item.key === active ? <Pildora grupo="menu" /> : null}
            <span className="dot" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="biz">
        {cfg?.data.negocio.nombre ? <div className="who">{cfg.data.negocio.nombre}</div> : null}
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
