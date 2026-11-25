"use client";

import type { ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Field";

/** Confirmación de acciones delicadas (eliminar, desactivar, activar un modelo menos preciso…). */
export function ConfirmarModal({
  titulo, children, confirmar, peligro, ocupado, error, onConfirmar, onClose,
}: {
  titulo: string;
  children: ReactNode;
  confirmar: string;
  peligro?: boolean;
  ocupado?: boolean;
  error?: string | null;
  onConfirmar: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      titulo={titulo}
      onClose={onClose}
      ocupado={ocupado}
      ancho={440}
      pie={
        <>
          <Button onClick={onClose} disabled={ocupado}>Cancelar</Button>
          <Button variant={peligro ? "danger" : "primary"} onClick={onConfirmar} loading={ocupado}>{confirmar}</Button>
        </>
      }
    >
      <div style={{ fontSize: 13, lineHeight: 1.55 }}>{children}</div>
      {error ? <div className="form-err" role="alert" style={{ marginTop: 14 }}>{error}</div> : null}
    </Modal>
  );
}
