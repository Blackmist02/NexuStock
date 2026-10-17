/** Límite superior «redondo» para el eje Y (1, 1,5, 2, 2,5, 3, 4, 5, 6, 8 × 10ⁿ). */
export function maximoLindo(max: number): number {
  if (!(max > 0)) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

export const MONO = "IBM Plex Mono, monospace";
