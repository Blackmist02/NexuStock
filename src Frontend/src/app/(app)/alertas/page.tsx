import type { Metadata } from "next";
import { AlertasView } from "./AlertasView";

export const metadata: Metadata = { title: "Historial de alertas" };

export default function AlertasPage() {
  return <AlertasView />;
}
