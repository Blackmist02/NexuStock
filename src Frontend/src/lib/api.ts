/**
 * Cliente HTTP de la API REST. Todas las llamadas van a /api/* (mismo origen; Next las reenvía a la API),
 * con la cookie httpOnly de sesión y la cabecera anti-CSRF que exige la API en mutaciones.
 */
import { reportarFallo, reportarOk } from "./conexion";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }

  /** Errores de validación por campo: { campo: mensaje } */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (this.code === "validacion" && Array.isArray(this.details)) {
      for (const d of this.details as { campo?: string; mensaje?: string }[]) {
        if (d?.campo && !out[d.campo]) out[d.campo] = d.mensaje ?? "Valor inválido";
      }
    }
    return out;
  }
}

export const MENSAJE_SIN_CONEXION = "Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.";

/** ¿El error es por falta de conexión (no por una respuesta del servidor)? */
export const esSinConexion = (e: unknown): boolean => e instanceof ApiClientError && e.code === "sin_conexion";

type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const qs = p.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

let onUnauthorized: (() => void) | null = null;
/** El AuthProvider registra aquí qué hacer cuando la sesión expira (401). */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "x-nx-csrf": "1" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(withQuery(`/api${path}`, query), {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    reportarFallo();
    throw new ApiClientError(0, "sin_conexion", MENSAJE_SIN_CONEXION);
  }
  if (res.status === 204) {
    reportarOk();
    return undefined as T;
  }
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* respuesta no JSON */
  }
  // Un 5xx que no trae el JSON de error de nuestra API viene del frontend porque no alcanzó al servidor.
  const esDeLaApi = !!(data as { error?: ApiErrorBody } | undefined)?.error;
  if (res.status >= 500 && !esDeLaApi) {
    reportarFallo();
    throw new ApiClientError(0, "sin_conexion", MENSAJE_SIN_CONEXION);
  }
  reportarOk();
  if (!res.ok) {
    const e = (data as { error?: ApiErrorBody } | undefined)?.error;
    if (res.status === 401 && path !== "/auth/login" && path !== "/auth/session") onUnauthorized?.();
    throw new ApiClientError(res.status, e?.code ?? "error", e?.message ?? `Error ${res.status}`, e?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  delete: <T>(path: string) => request<T>("DELETE", path),
  /** Descarga un archivo (p. ej. CSV) con la sesión actual. */
  async download(path: string, query?: Query, filename = "descarga.csv") {
    const res = await fetch(withQuery(`/api${path}`, query), { credentials: "same-origin", headers: { "x-nx-csrf": "1" } });
    if (!res.ok) throw new ApiClientError(res.status, "descarga", "No se pudo generar el archivo");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export const errorMessage = (e: unknown): string =>
  e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : "Ocurrió un error inesperado";
