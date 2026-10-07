"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  tipo: "ok" | "error";
  texto: string;
}
interface ToastCtx {
  ok: (texto: string) => void;
  error: (texto: string) => void;
}
const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((tipo: Toast["tipo"], texto: string) => {
    const id = ++seq.current;
    setItems((x) => [...x, { id, tipo, texto }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tipo === "error" ? 7000 : 4000);
  }, []);

  const value = useMemo<ToastCtx>(() => ({ ok: (t) => push("ok", t), error: (t) => push("error", t) }), [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tipo}`}>
            {t.texto}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return v;
}
