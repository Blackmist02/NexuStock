"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import type { Categoria } from "@/lib/tipos";
import { useGuardar } from "./useGuardar";

export function CategoriaModal({ categoria, onClose, onHecho }: { categoria?: Categoria; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const g = useGuardar();
  const [nombre, setNombre] = useState(categoria?.nombre ?? "");

  async function guardar() {
    if (nombre.trim().length < 2) {
      g.setCampos({ nombre: "Ingresa el nombre" });
      return;
    }
    g.setCampos({});
    const r = await g.ejecutar(() => (categoria ? api.put(`/categories/${categoria.id_categoria}`, { nombre: nombre.trim() }) : api.post("/categories", { nombre: nombre.trim() })));
    if (r) {
      toast.ok(categoria ? "Categoría actualizada" : "Categoría creada");
      onHecho();
    }
  }

  return (
    <Modal
      titulo={categoria ? "Editar categoría" : "Nueva categoría"}
      onClose={onClose}
      ocupado={g.enviando}
      ancho={420}
      pie={
        <>
          <Button onClick={onClose} disabled={g.enviando}>Cancelar</Button>
          <Button variant="primary" onClick={() => void guardar()} loading={g.enviando}>Guardar</Button>
        </>
      }
    >
      <TextField label="Nombre" placeholder="Ej.: Vacuno" value={nombre} onChange={(e) => setNombre(e.target.value)} error={g.campos.nombre} onKeyDown={(e) => e.key === "Enter" && void guardar()} />
      {g.error ? <div className="form-err" role="alert" style={{ marginTop: 14 }}>{g.error}</div> : null}
    </Modal>
  );
}
