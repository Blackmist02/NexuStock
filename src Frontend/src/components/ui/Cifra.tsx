"use client";

import { useEffect, useRef, useState } from "react";

interface CifraProps {
  valor: number;
  formato: (n: number) => string;
  /** Duración del conteo en ms. */
  duracion?: number;
}

const salidaSuave = (t: number) => 1 - Math.pow(1 - t, 4);

/**
 * Cifra que cuenta desde su valor anterior (0 la primera vez) hasta el nuevo, con desaceleración suave.
 * Lectores de pantalla y «reducir movimiento» reciben el valor final directamente.
 */
export function Cifra({ valor, formato, duracion = 1100 }: CifraProps) {
  const [mostrado, setMostrado] = useState(0);
  // Valor en pantalla en cada cuadro: el conteo siguiente parte de ahí (también si se interrumpe a la mitad).
  const actual = useRef(0);

  useEffect(() => {
    const inicio = actual.current;
    const fijar = (n: number) => {
      actual.current = n;
      setMostrado(n);
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || inicio === valor) {
      const id = requestAnimationFrame(() => fijar(valor));
      return () => cancelAnimationFrame(id);
    }
    let frame = 0;
    const t0 = performance.now();
    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - t0) / duracion);
      fijar(inicio + (valor - inicio) * salidaSuave(t));
      if (t < 1) frame = requestAnimationFrame(paso);
    };
    frame = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(frame);
  }, [valor, duracion]);

  // Los enteros se cuentan sin decimales intermedios (2 → «1,4» no tiene sentido para «productos»)
  const n = Number.isInteger(valor) ? Math.round(mostrado) : mostrado;
  return (
    <>
      <span aria-hidden="true">{formato(n)}</span>
      <span className="sr-only">{formato(valor)}</span>
    </>
  );
}
