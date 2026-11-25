import type { Metadata } from "next";
import { InventarioView } from "./InventarioView";

export const metadata: Metadata = { title: "Inventario" };

export default function InventarioPage() {
  return <InventarioView />;
}
