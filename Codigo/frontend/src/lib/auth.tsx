"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, esSinConexion, setUnauthorizedHandler } from "./api";
import { guardarUsuarioLocal, leerUsuarioLocal, limpiarCacheLocal } from "./cacheLocal";
import { useToast } from "@/components/ui/Toast";
import type { Rol } from "./permisos";

export interface Usuario {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
}

interface AuthCtx {
  user: Usuario | null;
  /** true mientras se consulta /auth/me por primera vez */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (nombre: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [user, setUser] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: Usuario | null }>("/auth/session");
      setUser(r.user);
      if (r.user) guardarUsuarioLocal(r.user);
      else limpiarCacheLocal();
    } catch (e) {
      // Sin conexión no sabemos si la sesión sigue vigente: se conserva el usuario guardado en este dispositivo.
      setUser(esSinConexion(e) ? leerUsuarioLocal<Usuario>() : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelado = false;
    api
      .get<{ user: Usuario | null }>("/auth/session")
      .then((r) => {
        if (cancelado) return;
        setUser(r.user);
        if (r.user) guardarUsuarioLocal(r.user);
        else limpiarCacheLocal();
      })
      .catch((e: unknown) => !cancelado && setUser(esSinConexion(e) ? leerUsuarioLocal<Usuario>() : null))
      .finally(() => !cancelado && setLoading(false));
    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      limpiarCacheLocal();
      setUser(null);
      router.replace("/login?expirada=1");
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ user: Usuario }>("/auth/login", { email, password });
    limpiarCacheLocal();
    guardarUsuarioLocal(r.user);
    setUser(r.user);
  }, []);

  const register = useCallback(async (nombre: string, email: string, password: string) => {
    const r = await api.post<{ user: Usuario }>("/auth/register", { nombre, email, password });
    limpiarCacheLocal();
    guardarUsuarioLocal(r.user);
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch (e) {
      // Sin conexión no se puede cerrar la sesión en el servidor: se queda abierta en vez de fingir que se cerró.
      if (esSinConexion(e)) {
        toast.error("Sin conexión: no se pudo cerrar la sesión. Inténtalo de nuevo cuando vuelva la conexión.");
        return;
      }
    }
    limpiarCacheLocal();
    setUser(null);
    router.replace("/login");
  }, [router, toast]);

  const value = useMemo<AuthCtx>(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return v;
}
