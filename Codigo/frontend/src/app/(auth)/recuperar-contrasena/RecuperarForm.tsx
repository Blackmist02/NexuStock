"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiClientError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PasswordRules, passwordValida } from "@/components/auth/PasswordRules";
import { Button, TextField } from "@/components/ui/Field";
import styles from "./page.module.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RecuperarForm() {
  const token = useSearchParams().get("token");
  return token ? <PasoNuevaContrasena token={token} /> : <PasoCorreo />;
}

/**
 * Paso 1: pide el correo. La API responde siempre 202 (no revela si el correo existe).
 * Nota para desarrollo: si la API no tiene SMTP configurado, el enlace de recuperación
 * se escribe en el log de la API en lugar de enviarse por correo.
 */
function PasoCorreo() {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campo, setCampo] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setCampo("Ingresa un correo válido");
      return;
    }
    setCampo(null);
    setEnviando(true);
    try {
      await api.post("/auth/forgot", { email: email.trim() });
      setEnviado(true);
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors.email) setCampo(err.fieldErrors.email);
      else setError(errorMessage(err));
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <div className={`card authcard ${styles.card}`}>
        <div className="eyebrow">Revisa tu correo</div>
        <h1 className="ah">Listo, revisa tu bandeja</h1>
        <div className="asub">
          Si <b style={{ color: "var(--ink)" }}>{email.trim()}</b> está registrado, te enviamos un enlace para crear una nueva contraseña. Vence en 30 minutos.
        </div>
        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={() => {
              setEnviado(false);
              setEmail("");
            }}
          >
            Usar otro correo
          </Button>
        </div>
        <div className={styles.back}>
          <Link href="/login">← Volver a iniciar sesión</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`card authcard ${styles.card}`}>
      <div className="eyebrow">Paso 1 de 2</div>
      <h1 className="ah">¿Olvidaste tu contraseña?</h1>
      <div className="asub">Escribe el correo de tu cuenta y te enviaremos un enlace para crear una nueva.</div>
      <form onSubmit={enviar} noValidate>
        <TextField
          label="Correo electrónico"
          type="email"
          name="email"
          autoComplete="username"
          placeholder="correo@carniceria.cl"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={campo}
          autoFocus
        />
        {error ? (
          <div className="form-err" role="alert">
            {error}
          </div>
        ) : null}
        <div style={{ height: 20 }} />
        <Button type="submit" variant="primary" size="block" loading={enviando}>
          Enviar enlace
        </Button>
      </form>
      <div className={styles.back}>
        <Link href="/login">← Volver a iniciar sesión</Link>
      </div>
    </div>
  );
}

/** Paso 2: el enlace trae `?token=`; se valida la política y se llama a /auth/reset. */
function PasoNuevaContrasena({ token }: { token: string }) {
  const { refresh } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [errorEnlace, setErrorEnlace] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    const c: Record<string, string> = {};
    if (!passwordValida(password)) c.password = "La contraseña no cumple los requisitos";
    if (confirmar !== password) c.confirmar = "Las contraseñas no coinciden";
    setCampos(c);
    setError(null);
    if (Object.keys(c).length) return;
    setEnviando(true);
    try {
      await api.post("/auth/reset", { token, password });
      setListo(true);
      void refresh(); // la API cierra la sesión actual al cambiar la contraseña
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "enlace_invalido") setErrorEnlace(err.message);
      else if (err instanceof ApiClientError && err.fieldErrors.password) setCampos({ password: err.fieldErrors.password });
      else setError(errorMessage(err));
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <div className={`card authcard ${styles.card}`}>
        <div className="eyebrow">Contraseña actualizada</div>
        <h1 className="ah">Ya puedes iniciar sesión</h1>
        <div className="asub">Guardamos tu nueva contraseña. Por seguridad, cerramos tus sesiones abiertas en otros dispositivos.</div>
        <Link href="/login" className="btn primary block" style={{ textDecoration: "none" }}>
          Iniciar sesión
        </Link>
      </div>
    );
  }

  if (errorEnlace) {
    return (
      <div className={`card authcard ${styles.card}`}>
        <div className="eyebrow">Enlace no válido</div>
        <h1 className="ah">No pudimos usar este enlace</h1>
        <div className="form-err" role="alert" style={{ marginTop: 0, marginBottom: 16 }}>
          {errorEnlace}
        </div>
        <Link href="/recuperar-contrasena" className="btn primary block" style={{ textDecoration: "none" }}>
          Solicitar un enlace nuevo
        </Link>
        <div className={styles.back}>
          <Link href="/login">← Volver a iniciar sesión</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`card authcard ${styles.card}`}>
      <div className="eyebrow">Paso 2 de 2</div>
      <h1 className="ah">Crea una nueva contraseña</h1>
      <div className="asub">Elige una contraseña que no uses en otros sitios.</div>
      <form onSubmit={enviar} noValidate>
        <div className={styles.stack}>
          <TextField
            label="Nueva contraseña"
            type="password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={campos.password}
            autoFocus
          />
          <TextField
            label="Confirmar contraseña"
            type="password"
            name="confirmar"
            autoComplete="new-password"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            error={campos.confirmar}
          />
        </div>
        <div className={styles.rules}>
          <PasswordRules password={password} />
        </div>
        {error ? (
          <div className="form-err" role="alert" style={{ marginTop: 0, marginBottom: 14 }}>
            {error}
          </div>
        ) : null}
        <Button type="submit" variant="primary" size="block" loading={enviando}>
          Guardar contraseña
        </Button>
      </form>
    </div>
  );
}
