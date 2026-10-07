import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Loading } from "@/components/ui/States";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Acceso" };

export default function LoginPage() {
  return (
    <AuthShell tagline="Gestión predictiva de inventario para carnicerías.">
      <Suspense fallback={<Loading />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
