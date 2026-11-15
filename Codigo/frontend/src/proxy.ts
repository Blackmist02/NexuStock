import { NextResponse, type NextRequest } from "next/server";

/**
 * Primera barrera: sin cookie de sesión no se sirven las pantallas de la aplicación.
 * Solo comprueba que la cookie exista; la validez real la decide la API (/api/auth/me) y,
 * si el token no sirve, <AppShell> manda a /login.
 */
const PUBLICAS = ["/login", "/crear-cuenta", "/recuperar-contrasena", "/conoce"];

/** URL interna de la API; se lee en tiempo de EJECUCIÓN (no hace falta recompilar al cambiar de proveedor). */
const API_URL = (process.env.API_URL || "http://localhost:4000").replace(/\/$/, "");

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // La API se sirve bajo el mismo origen: la cookie httpOnly de sesión viaja sin CORS.
  if (pathname.startsWith("/api/")) {
    // Una petición del propio sitio (Vercel, localhost o la IP de la red local) llega al backend sin `Origin`:
    // el backend rechaza con 403 los orígenes fuera de CORS_ORIGIN, y el del mismo sitio no tiene por qué estar ahí.
    // Un origen ajeno se reenvía tal cual para que el backend lo rechace.
    const headers = new Headers(req.headers);
    if (headers.get("origin") === req.nextUrl.origin) headers.delete("origin");
    return NextResponse.rewrite(new URL(`${pathname}${search}`, API_URL), { request: { headers } });
  }
  if (PUBLICAS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!req.cookies.has("nx_token")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
