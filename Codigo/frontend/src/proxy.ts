import { NextResponse, type NextRequest } from "next/server";

/**
 * Primera barrera: sin cookie de sesión no se sirven las pantallas de la aplicación.
 * Solo comprueba que la cookie exista; la validez real la decide la API (/api/auth/me) y,
 * si el token no sirve, <AppShell> manda a /login.
 */
const PUBLICAS = ["/login", "/crear-cuenta", "/recuperar-contrasena"];

/** URL interna de la API; se lee en tiempo de EJECUCIÓN (no hace falta recompilar al cambiar de proveedor). */
const API_URL = (process.env.API_URL || "http://localhost:4000").replace(/\/$/, "");

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // La API se sirve bajo el mismo origen: la cookie httpOnly de sesión viaja sin CORS.
  if (pathname.startsWith("/api/")) return NextResponse.rewrite(new URL(`${pathname}${search}`, API_URL));
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
