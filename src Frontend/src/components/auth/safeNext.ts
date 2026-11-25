/** Devuelve `next` solo si es una ruta interna segura (empieza con "/" y no con "//" ni "/\"). */
export function rutaInterna(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/")) return null;
  return next;
}
