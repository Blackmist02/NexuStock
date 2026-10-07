import styles from "./estados.module.css";

/** Carga de ruta (Suspense de Next): indicador simple centrado. */
export default function Cargando() {
  return (
    <div className={styles.page}>
      <div className={styles.loading} role="status" aria-live="polite">
        <span className="spin lg" aria-hidden="true" />
        Cargando…
      </div>
    </div>
  );
}
