import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // El indicador de desarrollo de Next quedaba sobre «Cerrar sesión» (abajo a la izquierda)
  devIndicators: { position: "top-right" },
  // En desarrollo Next bloquea sus recursos internos si la página se abre por la IP de la red (wifi) y no por localhost;
  // se permiten los rangos de red privada para probar desde el celular u otro equipo de la misma red
  allowedDevOrigins: ["10.*.*.*", "172.*.*.*", "192.168.*.*"],
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
