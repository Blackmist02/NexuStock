"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ApiClientError, errorMessage } from "@/lib/api";
import { rutaInterna } from "@/components/auth/safeNext";
import { Button, TextField } from "@/components/ui/Field";
import styles from "./page.module.css";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading, login } = useAuth();
  const destino = rutaInterna(params.get("next")) ?? "/dashboard";
  const expirada = params.get("expirada") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});

  // Con sesión activa no tiene sentido ver el acceso: se entra directo (también tras iniciar sesión).
  useEffect(() => {
    if (!loading && user) router.replace(destino);
  }, [loading, user, destino, router]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    const c: Record<string, string> = {};
    if (!email.trim()) c.email = "Ingresa tu correo electrónico";
    if (!password) c.password = "Ingresa tu contraseña";
    setCampos(c);
    setError(null);
    if (Object.keys(c).length) return;
    setEnviando(true);
    try {
      await login(email.trim(), password);
      // la redirección la hace el efecto de arriba al quedar la sesión cargada
    } catch (err) {
      setEnviando(false);
      if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length) setCampos(err.fieldErrors);
      setError(errorMessage(err));
    }
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.h1}>Iniciar sesión</h1>
      <p className={styles.sub}>Ingresa tus datos para entrar a tu cuenta</p>
      {expirada && !error ? (
        <div className={styles.notice} role="status">
          Tu sesión expiró. Inicia sesión nuevamente para continuar.
        </div>
      ) : null}
      <form onSubmit={enviar} noValidate>
        <div className={styles.stack}>
          <TextField
            label="Correo electrónico"
            type="email"
            name="email"
            autoComplete="username"
            placeholder="correo@carniceria.cl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={campos.email}
            autoFocus
          />
          <TextField
            label="Contraseña"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Tu contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={campos.password}
          />
        </div>
        <div className={styles.row}>
          <Link href="/recuperar-contrasena">¿Olvidaste tu contraseña?</Link>
        </div>
        {error ? (
          <div className="form-err" role="alert" style={{ marginTop: 0, marginBottom: 14 }}>
            {error}
          </div>
        ) : null}
        <Button type="submit" variant="primary" size="block" loading={enviando || (!loading && !!user)}>
          Iniciar sesión
        </Button>
      </form>
      <div className={styles.divider}>
        <span className={styles.ln} />o
        <span className={styles.ln} />
      </div>
      <div className={styles.foot}>
        ¿No tienes cuenta? <Link href="/crear-cuenta">Crear una</Link>
      </div>
    </div>
  );
}
