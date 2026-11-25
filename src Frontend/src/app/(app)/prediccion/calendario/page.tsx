import type { Metadata } from "next";
import { CalendarioView } from "./CalendarioView";

export const metadata: Metadata = { title: "Calendario de eventos" };

export default function CalendarioPage() {
  return <CalendarioView />;
}
