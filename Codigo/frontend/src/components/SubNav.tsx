import { ViewTransition } from "react";
import Link from "next/link";

/** Pestañas de una sección (p. ej. Inventario: Productos · Proveedores y categorías). */
export function SubNav({ items, activa }: { items: { href: string; label: string }[]; activa: string }) {
  return (
    <nav className="tabs" aria-label="Secciones">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={i.href === activa ? "on" : undefined} aria-current={i.href === activa ? "page" : undefined}>
          {i.href === activa ? (
            <ViewTransition name="tab-pill" share="nx-pill" default="none">
              <span className="nav-pill" aria-hidden="true" />
            </ViewTransition>
          ) : null}
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
