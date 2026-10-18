"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button, Switch, TextField } from "@/components/ui/Field";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ConfirmarModal } from "@/components/modales/ConfirmarModal";
import { UsuarioModal } from "@/components/modales/UsuarioModal";
import { CargaDatosCard, FechaSistemaCard } from "@/components/config/DatosYFecha";
import { useAuth } from "@/lib/auth";
import { ApiClientError, api, errorMessage } from "@/lib/api";
import { fmtFecha } from "@/lib/format";
import { FILAS_PERMISOS, puede, ROL_LABEL, type Rol } from "@/lib/permisos";
import type { ConfigNegocio, UsuarioFila } from "@/lib/tipos";
import { useApi } from "@/lib/useApi";

type Accion = null | { t: "nuevo" } | { t: "editar"; u: UsuarioFila } | { t: "estado"; u: UsuarioFila } | { t: "enlace"; u: UsuarioFila };

export function ConfiguracionView() {
  const { user } = useAuth();
  const toast = useToast();
  const permitido = puede(user?.rol, "usuarios");
  const cfg = useApi<{ data: ConfigNegocio }>("/config");
  const usuarios = useApi<{ data: UsuarioFila[] }>(permitido ? "/users" : null);

  const [editado, setNombre] = useState<string | null>(null);
  const [errNombre, setErrNombre] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [accion, setAccion] = useState<Accion>(null);
  const [ocupado, setOcupado] = useState(false);
  const [errAccion, setErrAccion] = useState<string | null>(null);
  const [enlace, setEnlace] = useState<{ url: string; min: number } | null>(null);

  const actual = cfg.data?.data;
  const nombre = editado ?? actual?.negocio.nombre ?? "";

  async function guardarConfig(cuerpo: Record<string, unknown>, ok: string) {
    setGuardando(true);
    setErrNombre(null);
    try {
      await api.put("/config", cuerpo);
      toast.ok(ok);
      setNombre(null);
      void cfg.reload();
    } catch (e) {
      if (e instanceof ApiClientError && e.fieldErrors.nombre) setErrNombre(e.fieldErrors.nombre);
      else toast.error(errorMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstado(u: UsuarioFila) {
    setOcupado(true);
    setErrAccion(null);
    try {
      await api.patch(`/users/${u.id}`, { activo: !u.activo });
      toast.ok(u.activo ? "Usuario desactivado" : "Usuario reactivado");
      setAccion(null);
      void usuarios.reload();
    } catch (e) {
      setErrAccion(errorMessage(e));
    } finally {
      setOcupado(false);
    }
  }

  async function generarEnlace(u: UsuarioFila) {
    setOcupado(true);
    setErrAccion(null);
    try {
      const r = await api.post<{ data: { enlace: string; vence_en_minutos: number } }>(`/users/${u.id}/reset-link`);
      setEnlace({ url: r.data.enlace, min: r.data.vence_en_minutos });
    } catch (e) {
      setErrAccion(errorMessage(e));
    } finally {
      setOcupado(false);
    }
  }

  async function copiar(txt: string) {
    try {
      await navigator.clipboard.writeText(txt);
      toast.ok("Enlace copiado");
    } catch {
      toast.error("No se pudo copiar: selecciónalo y cópialo a mano.");
    }
  }

  const cerrar = () => {
    setAccion(null);
    setErrAccion(null);
    setEnlace(null);
  };

  if (!permitido) {
    return (
      <AppShell active="configuracion">
        <div className="topbar"><div><h1 className="h1">Configuración</h1></div></div>
        <EmptyState title="No tienes acceso a esta sección" text="La configuración la gestionan los roles Administrador y TI." />
      </AppShell>
    );
  }

  const puedeEnlace = puede(user?.rol, "registrar_modelo"); // solo TI emite enlaces de restablecimiento

  return (
    <AppShell active="configuracion">
      <div className="topbar">
        <div>
          <h1 className="h1">Configuración</h1>
          <div className="subtitle">Negocio, alertas, fecha del sistema, carga de datos, equipo y permisos</div>
        </div>
      </div>

      {!actual && cfg.loading ? <Loading /> : null}
      {!actual && cfg.error ? <ErrorState message={cfg.error} onRetry={() => void cfg.reload()} /> : null}

      <div className="pgrid c2e" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="title">Tu carnicería</div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (nombre.trim().length < 2) return setErrNombre("Ingresa el nombre de la carnicería");
              void guardarConfig({ nombre: nombre.trim() }, "Datos guardados");
            }}
            noValidate
          >
            <TextField label="Nombre del negocio" placeholder="Ej.: Carnicería El Sur" value={nombre} onChange={(e) => setNombre(e.target.value)} error={errNombre} maxLength={80} />
            <div style={{ marginTop: 14 }}>
              <Button type="submit" variant="primary" loading={guardando} disabled={!actual || nombre.trim() === actual.negocio.nombre}>Guardar</Button>
            </div>
          </form>
        </div>
        <div className="card">
          <div className="title">Alertas</div>
          <div className="toggrow first">
            <div>
              <div className="togname">Alertas de quiebre</div>
              <div className="toghint">Avisa cuando un producto se acabará antes de que llegue el pedido.</div>
            </div>
            <Switch label="Alertas de quiebre" checked={actual?.alertas.quiebre ?? true} disabled={!actual || guardando} onChange={(v) => void guardarConfig({ alertas: { quiebre: v } }, v ? "Alertas de quiebre activadas" : "Alertas de quiebre desactivadas")} />
          </div>
          <div className="toggrow">
            <div>
              <div className="togname">Alertas de stock bajo</div>
              <div className="toghint">Avisa cuando el stock queda bajo lo que pide la demanda.</div>
            </div>
            <Switch label="Alertas de stock bajo" checked={actual?.alertas.bajo ?? true} disabled={!actual || guardando} onChange={(v) => void guardarConfig({ alertas: { bajo: v } }, v ? "Alertas de stock bajo activadas" : "Alertas de stock bajo desactivadas")} />
          </div>
          <div className="hint" style={{ marginTop: 10 }}>Los cambios se aplican en la próxima evaluación de alertas.</div>
        </div>
      </div>

      {actual?.fecha && puede(user?.rol, "fecha_sistema") ? (
        <div className={puede(user?.rol, "importar") ? "pgrid c2e cfg-datos" : ""} style={{ marginBottom: 16 }}>
          <FechaSistemaCard fecha={actual.fecha} onCambio={() => void cfg.reload()} />
          {puede(user?.rol, "importar") ? <CargaDatosCard key={actual.fecha.hoy} fecha={actual.fecha} onCambio={() => void cfg.reload()} /> : null}
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="title">
          Equipo
          <Button size="sm" variant="primary" onClick={() => setAccion({ t: "nuevo" })}>Nuevo usuario</Button>
        </div>
        {!usuarios.data && usuarios.loading ? <Loading /> : null}
        {!usuarios.data && usuarios.error ? <ErrorState message={usuarios.error} onRetry={() => void usuarios.reload()} /> : null}
        {usuarios.data ? (
          <div className="scrollx">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Nombre</th>
                  <th scope="col">Correo</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Alta</th>
                  <th scope="col">Estado</th>
                  <th scope="col"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {usuarios.data.data.map((u) => {
                  const yo = u.id === user?.id;
                  return (
                    <tr key={u.id} style={u.activo ? undefined : { opacity: 0.6 }}>
                      <td>{u.nombre}{yo ? <span className="mini"> (tú)</span> : null}</td>
                      <td>{u.email}</td>
                      <td>{ROL_LABEL[u.rol]}</td>
                      <td>{fmtFecha(u.creado_en)}</td>
                      <td><span className={u.activo ? "badge saludable" : "badge neutral"}>{u.activo ? "Activo" : "Inactivo"}</span></td>
                      <td>
                        <div className="row-actions">
                          <Button size="sm" onClick={() => setAccion({ t: "editar", u })}>Editar</Button>
                          {puedeEnlace && u.activo && !yo ? <Button size="sm" onClick={() => { setErrAccion(null); setAccion({ t: "enlace", u }); }}>Enlace de acceso</Button> : null}
                          {!yo ? <Button size="sm" onClick={() => { setErrAccion(null); setAccion({ t: "estado", u }); }}>{u.activo ? "Desactivar" : "Reactivar"}</Button> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="title">Permisos por rol</div>
        <div className="scrollx">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">Acción</th>
                {(Object.keys(ROL_LABEL) as Rol[]).map((r) => <th key={r} scope="col" className="ctr">{ROL_LABEL[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {FILAS_PERMISOS.map((f) => (
                <tr key={f.texto}>
                  <td>{f.texto}</td>
                  {(Object.keys(ROL_LABEL) as Rol[]).map((r) => (
                    <td key={r} className="ctr" aria-label={f.roles.includes(r) ? "Sí" : "No"}>{f.roles.includes(r) ? "✓" : <span style={{ color: "var(--ink-muted)" }}>—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {accion?.t === "nuevo" ? <UsuarioModal onClose={cerrar} onHecho={() => { cerrar(); void usuarios.reload(); }} /> : null}
      {accion?.t === "editar" ? <UsuarioModal usuario={accion.u} esYo={accion.u.id === user?.id} onClose={cerrar} onHecho={() => { cerrar(); void usuarios.reload(); }} /> : null}
      {accion?.t === "estado" ? (
        <ConfirmarModal titulo={accion.u.activo ? "Desactivar usuario" : "Reactivar usuario"} confirmar={accion.u.activo ? "Desactivar" : "Reactivar"} ocupado={ocupado} error={errAccion} onClose={cerrar} onConfirmar={() => void cambiarEstado(accion.u)}>
          {accion.u.activo ? `${accion.u.nombre} no podrá iniciar sesión. Sus registros anteriores se conservan.` : `${accion.u.nombre} podrá volver a iniciar sesión.`}
        </ConfirmarModal>
      ) : null}
      {accion?.t === "enlace" && !enlace ? (
        <ConfirmarModal titulo="Enlace de acceso" confirmar="Generar enlace" ocupado={ocupado} error={errAccion} onClose={cerrar} onConfirmar={() => void generarEnlace(accion.u)}>
          Se generará un enlace para que {accion.u.nombre} cree una contraseña nueva. Vence en 30 minutos y debes entregárselo por un canal seguro.
        </ConfirmarModal>
      ) : null}
      {enlace && accion?.t === "enlace" ? (
        <Modal titulo="Enlace de acceso" subtitulo={`Vence en ${enlace.min} minutos. Compártelo solo con ${accion.u.nombre}.`} onClose={cerrar}
          pie={<><Button onClick={cerrar}>Cerrar</Button><Button variant="primary" onClick={() => void copiar(enlace.url)}>Copiar enlace</Button></>}>
          <input className="input mono" readOnly value={enlace.url} aria-label="Enlace de restablecimiento" onFocus={(e) => e.currentTarget.select()} />
        </Modal>
      ) : null}
    </AppShell>
  );
}
