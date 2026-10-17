"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

interface ModalProps {
  titulo: string;
  subtitulo?: string;
  onClose: () => void;
  children: ReactNode;
  /** Botones del pie (se alinean a la derecha). */
  pie?: ReactNode;
  ancho?: number;
  /** Mientras se guarda no se puede cerrar. */
  ocupado?: boolean;
}

/** Ventana modal accesible (.modal del diseño): Esc y clic fuera cierran; el foco entra al primer campo. */
export function Modal({ titulo, subtitulo, onClose, children, pie, ancho, ocupado }: ModalProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const primero = ref.current?.querySelector<HTMLElement>("input:not([readonly]):not([type=hidden]), select, textarea");
    (primero ?? ref.current)?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      previo?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !ocupado) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, ocupado]);

  return (
    <div className="overlay">
      <div className="scrim" onClick={() => !ocupado && onClose()} aria-hidden="true" />
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} style={ancho ? { width: ancho } : undefined}>
        <div className="mhead">
          <div className="mtitle" id={id}>
            {titulo}
          </div>
          <button type="button" className="xbtn" aria-label="Cerrar" onClick={onClose} disabled={ocupado}>
            ×
          </button>
        </div>
        {subtitulo ? <div className="msub">{subtitulo}</div> : <div style={{ height: 14 }} />}
        {children}
        {pie ? <div className="mfoot">{pie}</div> : null}
      </div>
    </div>
  );
}
