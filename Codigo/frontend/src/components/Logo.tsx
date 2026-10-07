type LogoProps = { width?: number; height?: number };

/** Sello NS + wordmark "nexustock". Usa los tokens del tema (--ink, --accent). */
export function Logo({ width = 132, height = 48 }: LogoProps) {
  return (
    <svg viewBox="0 0 246 90" width={width} height={height} role="img" aria-label="NexuStock">
      <g transform="translate(6,5)">
        <circle cx="40" cy="40" r="30" fill="none" stroke="var(--ink)" strokeWidth="3" />
        <circle cx="40" cy="10" r="2.6" fill="var(--accent)" />
        <circle cx="40" cy="70" r="2.6" fill="var(--accent)" />
        <text
          x="40"
          y="49"
          fontFamily="Bricolage Grotesque, sans-serif"
          fontWeight="700"
          fontSize="27"
          letterSpacing="-1"
          fill="var(--ink)"
          textAnchor="middle"
        >
          NS
        </text>
      </g>
      <text
        x="88"
        y="50"
        fontFamily="Bricolage Grotesque, sans-serif"
        fontWeight="700"
        fontSize="30"
        letterSpacing="-0.4"
        fill="var(--ink)"
      >
        nexustock
      </text>
    </svg>
  );
}
