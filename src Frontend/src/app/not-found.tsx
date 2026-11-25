import type { Metadata } from "next";
import Link from "next/link";
import styles from "./estados.module.css";

export const metadata: Metadata = { title: "Página no encontrada" };

export default function NoEncontrada() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <span className={`${styles.mark} ${styles.info}`} aria-hidden="true">
          ?
        </span>
        <div className={styles.code}>Error 404</div>
        <h1 className={styles.title}>No encontramos esta página</h1>
        <p className={styles.text}>La dirección no existe o fue movida. Revisa que esté bien escrita o vuelve al inicio.</p>
        <div className={styles.actions}>
          <Link href="/dashboard" className="btn primary">
            Ir al dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
