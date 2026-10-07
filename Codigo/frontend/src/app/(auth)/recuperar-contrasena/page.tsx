import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Loading } from "@/components/ui/States";
import { RecuperarForm } from "./RecuperarForm";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function RecuperarContrasenaPage() {
  return (
    <AuthShell
      tagline="Recupera el acceso a tu cuenta."
      bottom={
        <div className="quote">
          Por seguridad, el enlace de recuperación <b>vence en 30 minutos</b> y solo se puede usar una vez.
        </div>
      }
    >
      <Suspense fallback={<Loading />}>
        <RecuperarForm />
      </Suspense>
    </AuthShell>
  );
}
