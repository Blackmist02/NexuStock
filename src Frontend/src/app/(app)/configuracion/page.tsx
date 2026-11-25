import type { Metadata } from "next";
import { ConfiguracionView } from "./ConfiguracionView";

export const metadata: Metadata = { title: "Configuración" };

export default function ConfiguracionPage() {
  return <ConfiguracionView />;
}
