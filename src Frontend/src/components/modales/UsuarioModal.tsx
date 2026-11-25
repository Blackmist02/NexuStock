"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button, SelectField, TextField } from "@/components/ui/Field";
import { PasswordRules, passwordValida } from "@/components/auth/PasswordRules";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { ROL_LABEL, type Rol } from "@/lib/permisos";
import type { UsuarioFila } from "@/lib/tipos";
import { useGuardar } from "./useGuardar";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** RF-12: alta de un integrante del equipo o cambio de nombre/rol. */
export function UsuarioModal({ usuario, esYo, onClose, onHecho }: { usuario?: UsuarioFila; esYo?: boolean; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const g = useGuardar();
  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [email, setEmail] = useState(usuario?.email ?? "");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<Rol>(usuario?.rol ?? "operador");

  async function guardar() {
    const c: Record<string, string> = {};
    if (nombre.trim().length < 2) c.nombre = "Ingresa el nombre";
    if (!usuario && !EMAIL_RE.test(email.trim())) c.email = "Ingresa un correo válido";
    if (!usuario && !passwordValida(password)) c.password = "La contraseña no cumple los requisitos";
    g.setCampos(c);
    if (Object.keys(c).length) return;
    const r = await g.ejecutar(() =>
      usuario
        ? api.patch(`/users/${usuario.id}`, { nombre: nombre.trim(), ...(esYo ? {} : { rol }) })
        : api.post("/users", { nombre: nombre.trim(), email: email.trim(), password, rol }),
    );
    if (r) {
      toast.ok(usuario ? "Usuario actualizado" : "Usuario creado");
      onHecho();
    }
  }

  return (
    <Modal
      titulo={usuario ? "Editar usuario" : "Nuevo usuario"}
      subtitulo={usuario ? undefined : "Entrégale la contraseña inicial por un canal seguro; podrá cambiarla con «Olvidé mi contraseña»."}
      onClose={onClose}
      ocupado={g.enviando}
      pie={
        <>
          <Button onClick={onClose} disabled={g.enviando}>Cancelar</Button>
          <Button variant="primary" onClick={() => void guardar()} loading={g.enviando}>{usuario ? "Guardar" : "Crear usuario"}</Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField className="full" label="Nombre completo" placeholder="Ej.: María Pérez" value={nombre} onChange={(e) => setNombre(e.target.value)} error={g.campos.nombre} />
        <TextField className="full" label="Correo electrónico" placeholder="Correo electrónico" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={g.campos.email} disabled={!!usuario} autoComplete="off" />
        {!usuario ? (
          <div className="full">
            <TextField label="Contraseña inicial" placeholder="Crea una contraseña inicial" type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={g.campos.password} autoComplete="new-password" />
            <div style={{ marginTop: 8 }}><PasswordRules password={password} /></div>
          </div>
        ) : null}
        <SelectField className="full" label="Rol" value={rol} onChange={(e) => setRol(e.target.value as Rol)} disabled={esYo} error={g.campos.rol} hint={esYo ? "No puedes cambiar tu propio rol." : undefined}>
          {(Object.keys(ROL_LABEL) as Rol[]).map((r) => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
        </SelectField>
      </div>
      {g.error ? <div className="form-err" role="alert" style={{ marginTop: 14 }}>{g.error}</div> : null}
    </Modal>
  );
}
