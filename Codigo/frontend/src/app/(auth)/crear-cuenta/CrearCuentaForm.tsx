"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { ApiClientError, errorMessage } from "@/lib/api";
import { PasswordRules, passwordValida } from "@/components/auth/PasswordRules";
import { Button, TextField } from "@/components/ui/Field";
import { ErrorState, Loading } from "@/components/ui/States";
import styles from "./page.module.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CrearCuentaForm() {
  const router = useRouter();
  const { register } = useAuth();
  const estado = useApi<{ necesitaRegistro: boolean; registroAbierto: boolean }>("/auth/setup-status");

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});

  if (estado.loading && !estado.data) return <Loading texto="Comprobando…" />;
  if (estado.error || !estado.data) {
    return <ErrorState message={estado.error ?? "No pudimos comprobar el estado del sistema."} onRetry={() => void estado.reload()} />;
  }

  if (!estado.data.registroAbierto) {
    return (
      <div className={styles.card}>
        <h1 className={styles.h1}>Crear cuenta</h1>
        <div className={styles.closed}>
          <p className={styles.sub} style={{ margin: 0 }}>
            El registro de cuentas nuevas está cerrado. Pide a un administrador de NexuStock que te dé acceso y luego inicia sesión con el correo y la
            contraseña que te entregue.
          </p>
          <Link href="/login" className="btn primary" style={{ textDecoration: "none" }}>
            Ir a iniciar sesión
          </Link>
        </div>
      </div>
    );
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    const c: Record<string, string> = {};
    if (nombre.trim().length < 2) c.nombre = "Ingresa tu nombre completo";
    if (!EMAIL_RE.test(email.trim())) c.email = "Ingresa un correo válido";
    if (!passwordValida(password)) c.password = "La contraseña no cumple los requisitos";
    setCampos(c);
    setError(null);
    if (Object.keys(c).length) return;
    setEnviando(true);
    try {
      await register(nombre.trim(), email.trim(), password);
      router.replace("/dashboard");
    } catch (err) {
      setEnviando(false);
      if (err instanceof ApiClientError) {
        setCampos(err.fieldErrors);
        // si otra persona creó la cuenta mientras tanto, el registro ya no está abierto
        if (err.status === 403) void estado.reload();
      }
      setError(errorMessage(err));
    }
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.h1}>Crear cuenta</h1>
      <p className={styles.sub}>Serás el administrador de tu carnicería en NexuStock</p>
      <form onSubmit={enviar} noValidate>
        <div className={styles.stack}>
          <TextField
            label="Nombre completo"
            name="nombre"
            autoComplete="name"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            error={campos.nombre}
            autoFocus
          />
          <TextField
            label="Correo electrónico"
            type="email"
            name="email"
            autoComplete="username"
            placeholder="correo@carniceria.cl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={campos.email}
          />
          <TextField
            label="Contraseña"
            type="password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={campos.password}
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
          Crear cuenta
        </Button>
      </form>
      <div className={styles.foot}>
        ¿Ya tienes cuenta? <Link href="/login">Iniciar sesión</Link>
      </div>
    </div>
  );
}
