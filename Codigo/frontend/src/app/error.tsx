"use client";

import Link from "next/link";
import styles from "./estados.module.css";

/** Error inesperado dentro de una ruta: se puede reintentar sin recargar toda la aplicación. */
export default function ErrorDeRuta({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className={styles.page}>
      <div className={styles.card} role="alert">
        <span className={`${styles.mark} ${styles.err}`} aria-hidden="true">
          !
        </span>
        <div className={styles.code}>Error inesperado</div>
        <h1 className={styles.title}>Algo salió mal</h1>
        <p className={styles.text}>No pudimos mostrar esta pantalla. Tus datos están a salvo; puedes reintentar o volver al dashboard.</p>
        <div className={styles.actions}>
          <button type="button" className="btn primary" onClick={() => reset()}>
            Reintentar
          </button>
          <Link href="/dashboard" className="btn ghost">
            Ir al dashboard
          </Link>
        </div>
        {error.digest ? <div className={styles.ref}>Referencia: {error.digest}</div> : null}
      </div>
    </div>
  );
}
