/**
 * Copia local (localStorage) de la última información consultada, como resguardo cuando no hay conexión.
 * Todo está envuelto en try/catch: si el almacenamiento no está disponible, la app sigue funcionando sin resguardo.
 * Se borra al cerrar sesión o cuando la sesión expira, para no dejar datos en equipos compartidos.
 */
const PREFIJO = "nx:cache:v1:";
const CLAVE_USUARIO = "nx:usuario:v1";

interface Entrada<T> {
  guardado_en: string;
  data: T;
}

export function guardarCache<T>(clave: string, data: T): void {
  try {
    const e: Entrada<T> = { guardado_en: new Date().toISOString(), data };
    localStorage.setItem(PREFIJO + clave, JSON.stringify(e));
  } catch {
    /* sin almacenamiento o cuota llena: se ignora */
  }
}

export function leerCache<T>(clave: string): Entrada<T> | null {
  try {
    const raw = localStorage.getItem(PREFIJO + clave);
    if (!raw) return null;
    const e = JSON.parse(raw) as Entrada<T>;
    return e && typeof e.guardado_en === "string" && "data" in e ? e : null;
  } catch {
    return null;
  }
}

export function guardarUsuarioLocal<T>(u: T): void {
  try {
    localStorage.setItem(CLAVE_USUARIO, JSON.stringify(u));
  } catch {
    /* se ignora */
  }
}

export function leerUsuarioLocal<T>(): T | null {
  try {
    const raw = localStorage.getItem(CLAVE_USUARIO);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Borra el resguardo local (datos y usuario). */
export function limpiarCacheLocal(): void {
  try {
    const borrar: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(PREFIJO) || k === CLAVE_USUARIO)) borrar.push(k);
    }
    borrar.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* se ignora */
  }
}
