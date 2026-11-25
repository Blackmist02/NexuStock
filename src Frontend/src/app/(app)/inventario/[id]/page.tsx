import type { Metadata } from "next";
import { DetalleProductoView } from "./DetalleProductoView";

export const metadata: Metadata = { title: "Detalle de producto" };

export default async function DetalleProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetalleProductoView id={id} />;
}
