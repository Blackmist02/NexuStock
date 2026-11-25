import type { Metadata } from "next";
import { HistorialView } from "./HistorialView";

export const metadata: Metadata = { title: "Historial y reportes" };

export default function HistorialPage() {
  return <HistorialView />;
}
