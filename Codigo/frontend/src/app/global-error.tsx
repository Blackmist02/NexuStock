"use client";

import "@/styles/globals.css";
import styles from "./estados.module.css";

// Mismo script que el layout raíz: aplica el tema guardado antes del primer pintado.
const THEME_SCRIPT = `try{var t=localStorage.getItem("nx-theme");if(t==="oscuro"||t==="crema"){document.documentElement.dataset.theme=t}}catch(e){}`;

/** Error en el propio layout raíz: reemplaza toda la página, por eso define <html> y <body>. */
export default function ErrorGlobal({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es" data-theme="oscuro" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <div className={styles.page}>
          <div className={styles.card} role="alert">
            <span className={`${styles.mark} ${styles.err}`} aria-hidden="true">
              !
            </span>
            <div className={styles.code}>Error crítico</div>
            <h1 className={styles.title}>NexuStock no pudo cargar</h1>
            <p className={styles.text}>Ocurrió un problema al iniciar la aplicación. Tus datos están a salvo. Reintenta o recarga la página.</p>
            <div className={styles.actions}>
              <button type="button" className="btn primary" onClick={() => reset()}>
                Reintentar
              </button>
              <button type="button" className="btn ghost" onClick={() => window.location.reload()}>
                Recargar la página
              </button>
            </div>
            {error.digest ? <div className={styles.ref}>Referencia: {error.digest}</div> : null}
          </div>
        </div>
      </body>
    </html>
  );
}
