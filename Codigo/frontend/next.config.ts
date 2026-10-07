import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // El indicador de desarrollo de Next quedaba sobre «Cerrar sesión» (abajo a la izquierda)
  devIndicators: { position: "top-right" },
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
