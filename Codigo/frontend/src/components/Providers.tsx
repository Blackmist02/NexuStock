"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";
import { ConexionMonitor } from "./ConexionAviso";
import { ToastProvider } from "./ui/Toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConexionMonitor />
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}
