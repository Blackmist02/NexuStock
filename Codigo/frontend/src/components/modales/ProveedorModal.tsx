"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { DIAS_SEMANA, parseNum } from "@/lib/format";
import type { Proveedor } from "@/lib/tipos";
import { useGuardar } from "./useGuardar";

/** Alta/edición de proveedor: lead time y días hábiles de atención (base de la fecha límite para pedir). */
export function ProveedorModal({ proveedor, onClose, onHecho }: { proveedor?: Proveedor; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const g = useGuardar();
  const [nombre, setNombre] = useState(proveedor?.nombre ?? "");
  const [contacto, setContacto] = useState(proveedor?.contacto ?? "");
  const [lead, setLead] = useState(proveedor ? String(proveedor.lead_time_dias) : "1");
  const [dias, setDias] = useState<number[]>(proveedor?.dias_habiles ?? [1, 2, 3, 4, 5]);

  async function guardar() {
    const c: Record<string, string> = {};
    const n = parseNum(lead);
    if (nombre.trim().length < 2) c.nombre = "Ingresa el nombre";
    if (n == null || !Number.isInteger(n) || n < 0 || n > 365) c.lead_time_dias = "El lead time debe ser un número de días (0 o más)";
    if (dias.length === 0) c.dias_habiles = "Elige al menos un día hábil de atención";
    g.setCampos(c);
    if (Object.keys(c).length) return;
    const cuerpo = { nombre: nombre.trim(), contacto: contacto.trim() || null, lead_time_dias: n, dias_habiles: dias };
    const r = await g.ejecutar(() => (proveedor ? api.put(`/suppliers/${proveedor.id_proveedor}`, cuerpo) : api.post("/suppliers", cuerpo)));
    if (r) {
      toast.ok(proveedor ? "Proveedor actualizado" : "Proveedor creado");
      onHecho();
    }
  }

  return (
    <Modal
      titulo={proveedor ? "Editar proveedor" : "Nuevo proveedor"}
      subtitulo="El lead time y los días hábiles definen hasta cuándo conviene hacer el pedido."
      onClose={onClose}
      ocupado={g.enviando}
      pie={
        <>
          <Button onClick={onClose} disabled={g.enviando}>Cancelar</Button>
          <Button variant="primary" onClick={() => void guardar()} loading={g.enviando}>{proveedor ? "Guardar cambios" : "Crear proveedor"}</Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField className="full" label="Nombre" placeholder="Ej.: Distribuidora Sur" value={nombre} onChange={(e) => setNombre(e.target.value)} error={g.campos.nombre} />
        <TextField className="full" label="Contacto" placeholder="Ej.: +56 9 1234 5678" value={contacto} onChange={(e) => setContacto(e.target.value)} error={g.campos.contacto} />
        <TextField label="Lead time (días)" placeholder="Ej.: 2" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} error={g.campos.lead_time_dias} hint="Días entre el pedido y la entrega." />
        <div className="fieldgrp">
          <label id="dias-l">Días hábiles de atención</label>
          <div className="dias" role="group" aria-labelledby="dias-l">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button
                key={d}
                type="button"
                className={dias.includes(d) ? "on" : undefined}
                aria-pressed={dias.includes(d)}
                onClick={() => setDias((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort()))}
              >
                {DIAS_SEMANA[d]}
              </button>
            ))}
          </div>
          {g.campos.dias_habiles ? <span className="field-err" role="alert">{g.campos.dias_habiles}</span> : null}
        </div>
      </div>
      {g.error ? <div className="form-err" role="alert" style={{ marginTop: 14 }}>{g.error}</div> : null}
    </Modal>
  );
}
