/**
 * Traduce nombres de clase del diseño ("btn primary") a las clases locales de un CSS Module.
 * Los nombres que no existan en el módulo se ignoran.
 */
export function cls(styles: Record<string, string>) {
  return (names: string): string | undefined => {
    const out = names
      .split(" ")
      .map((n) => styles[n])
      .filter(Boolean)
      .join(" ");
    return out || undefined;
  };
}
