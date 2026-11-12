import type { NextConfig } from "next";

/**
 * En `next dev`, Next 16 bloquea (403) los scripts /_next/* y el HMR pedidos desde un origen
 * distinto de localhost: al abrir la app por IP desde otro PC de la red la página se ve, pero
 * React no hidrata y los botones (login, registro…) no hacen nada. Se permiten las redes privadas
 * habituales; para otro host/dominio añádelo en DEV_ORIGINS (separado por comas). No afecta a `next start`.
 */
const allowedDevOrigins = [
  "10.*.*.*",
  "172.*.*.*",
  "192.168.*.*",
  "*.local",
  ...(process.env.DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins,
  poweredByHeader: false,
  // El indicador de desarrollo de Next tapaba controles en cualquier esquina («Cerrar sesión» abajo a la izquierda,
  // botones del encabezado arriba a la derecha, botón de tema abajo a la derecha). Los errores siguen mostrándose.
  devIndicators: false,
  // /api/* se reenvía al backend en src/proxy.ts (URL leída de API_URL; por defecto http://localhost:4000)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
