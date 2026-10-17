import type { Metadata } from "next";
import { ProveedoresView } from "./ProveedoresView";

export const metadata: Metadata = { title: "Proveedores y categorías" };

export default function ProveedoresPage() {
  return <ProveedoresView />;
}
