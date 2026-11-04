import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Providers } from "@/components/Providers";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: { default: "NexuStock", template: "%s · NexuStock" },
  description:
    "Sistema web predictivo de gestión de inventario para carnicerías independientes: semáforo de stock, sugerencias de compra y precisión del modelo (MAE).",
};

const FONTS =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap";

// Aplica el tema guardado antes del primer pintado para evitar parpadeo.
const THEME_SCRIPT = `try{var t=localStorage.getItem("nx-theme");if(t==="oscuro"||t==="crema"){document.documentElement.dataset.theme=t}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" data-theme="oscuro" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS} />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <ThemeToggle />
      </body>
    </html>
  );
}
