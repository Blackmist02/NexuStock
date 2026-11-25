import type { Metadata } from "next";
import { ModeloView } from "./ModeloView";

export const metadata: Metadata = { title: "Precisión del modelo" };

export default function ModeloPage() {
  return <ModeloView />;
}
