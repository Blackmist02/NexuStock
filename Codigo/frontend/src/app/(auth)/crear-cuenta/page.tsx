import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { CrearCuentaForm } from "./CrearCuentaForm";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function CrearCuentaPage() {
  return (
    <AuthShell
      tagline="Empieza a predecir tu demanda en minutos."
      aside={
        <ol className={styles.steps} style={{ listStyle: "none", padding: 0, marginBottom: 0 }}>
          <li className={styles.step}>
            <span className={styles.n}>1</span>Crea tu cuenta
          </li>
          <li className={styles.step}>
            <span className={styles.n}>2</span>Entra al dashboard con tu cuenta
          </li>
          <li className={styles.step}>
            <span className={styles.n}>3</span>Revisa el semáforo de tu inventario
          </li>
        </ol>
      }
    >
      <CrearCuentaForm />
    </AuthShell>
  );
}
