import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import styles from "./AuthShell.module.css";

interface AuthShellProps {
  tagline: string;
  /** Contenido bajo el eslogan del panel izquierdo (pasos, etc.) */
  aside?: ReactNode;
  /** Texto al pie del panel izquierdo */
  bottom?: ReactNode;
  children: ReactNode;
}

/** Marco de las pantallas de acceso: panel de marca a la izquierda y el formulario a la derecha. */
export function AuthShell({ tagline, aside, bottom, children }: AuthShellProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.left}>
        <div>
          <Logo width={168} height={61} />
          <div className={styles.tagline}>{tagline}</div>
          {aside}
        </div>
        <svg className={styles.art} width="420" height="200" viewBox="0 0 420 200" aria-hidden="true">
          <path
            d="M0,160 L60,140 L120,150 L180,100 L240,90 L300,50 L360,65 L420,30"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="10"
          />
        </svg>
        {bottom ? <div className={styles.bottom}>{bottom}</div> : null}
      </div>
      <main className={styles.right}>
        <div className={styles.inner}>
          <div className={styles.mobilebrand}>
            <Logo width={132} height={48} />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
