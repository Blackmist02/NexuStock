import type { Metadata } from "next";
import { PrediccionView } from "./PrediccionView";

export const metadata: Metadata = { title: "Predicción" };

export default function PrediccionPage() {
  return <PrediccionView />;
}
