"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { hoyISO, parseNum } from "@/lib/format";
import { useGuardar } from "./useGuardar";

/** RF-06: registra una versión del modelo (queda inactiva hasta que se active). */
export function ModeloModal({ onClose, onHecho }: { onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const g = useGuardar();
  const [f, setF] = useState({
    algoritmo: "Random Forest",
    version: "",
    mae_general: "",
    mae_festivos: "",
    entrenado_desde: "",
    entrenado_hasta: "",
    prueba_desde: "",
    prueba_hasta: hoyISO(),
    artefacto_ruta: "models/",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function guardar() {
    const c: Record<string, string> = {};
    const mg = parseNum(f.mae_general);
    const mf = f.mae_festivos.trim() ? parseNum(f.mae_festivos) : null;
    if (f.algoritmo.trim().length < 2) c.algoritmo = "Ingresa el algoritmo";
    if (!f.version.trim()) c.version = "Ingresa la versión";
    if (mg == null || mg < 0) c.mae_general = "El MAE general debe ser un número de 0 o más";
    if (f.mae_festivos.trim() && (mf == null || mf < 0)) c.mae_festivos = "El MAE en festivos debe ser un número de 0 o más";
    for (const k of ["entrenado_desde", "entrenado_hasta", "prueba_desde", "prueba_hasta"] as const) if (!f[k]) c[k] = "Elige una fecha";
    if (f.artefacto_ruta.trim().length < 3) c.artefacto_ruta = "Ingresa la ruta del artefacto";
    g.setCampos(c);
    if (Object.keys(c).length) return;
    const r = await g.ejecutar(() =>
      api.post("/models", { ...f, algoritmo: f.algoritmo.trim(), version: f.version.trim(), artefacto_ruta: f.artefacto_ruta.trim(), mae_general: mg, mae_festivos: mf }),
    );
    if (r) {
      toast.ok("Versión del modelo registrada");
      onHecho();
    }
  }

  return (
    <Modal
      titulo="Registrar versión del modelo"
      subtitulo="Queda inactiva hasta que la actives. El artefacto debe estar dentro de la carpeta ml-engine del servidor."
      onClose={onClose}
      ocupado={g.enviando}
      ancho={560}
      pie={
        <>
          <Button onClick={onClose} disabled={g.enviando}>Cancelar</Button>
          <Button variant="primary" onClick={() => void guardar()} loading={g.enviando}>Registrar versión</Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField label="Algoritmo" placeholder="Ej.: Random Forest" value={f.algoritmo} onChange={set("algoritmo")} error={g.campos.algoritmo} />
        <TextField label="Versión" placeholder="Ej.: v1.0" value={f.version} onChange={set("version")} error={g.campos.version} />
        <TextField label="MAE general (kg)" placeholder="Ej.: 3,6" inputMode="decimal" value={f.mae_general} onChange={set("mae_general")} error={g.campos.mae_general} />
        <TextField label="MAE en festivos (kg)" placeholder="Ej.: 5,7" inputMode="decimal" value={f.mae_festivos} onChange={set("mae_festivos")} error={g.campos.mae_festivos} hint="Opcional" />
        <TextField label="Entrenado desde" type="date" value={f.entrenado_desde} onChange={set("entrenado_desde")} error={g.campos.entrenado_desde} />
        <TextField label="Entrenado hasta" type="date" value={f.entrenado_hasta} onChange={set("entrenado_hasta")} error={g.campos.entrenado_hasta} />
        <TextField label="Prueba desde" type="date" value={f.prueba_desde} onChange={set("prueba_desde")} error={g.campos.prueba_desde} />
        <TextField label="Prueba hasta" type="date" value={f.prueba_hasta} onChange={set("prueba_hasta")} error={g.campos.prueba_hasta} />
        <TextField className="full" label="Ruta del artefacto" placeholder="Ej.: models/modelo_v1.joblib" value={f.artefacto_ruta} onChange={set("artefacto_ruta")} error={g.campos.artefacto_ruta} />
      </div>
      {g.error ? <div className="form-err" role="alert" style={{ marginTop: 14 }}>{g.error}</div> : null}
    </Modal>
  );
}
