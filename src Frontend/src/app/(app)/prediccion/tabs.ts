import type { Rol } from "@/lib/permisos";
import { puede } from "@/lib/permisos";

export const tabsPrediccion = (rol: Rol | undefined) => [
  { href: "/prediccion", label: "Demanda y alertas" },
  { href: "/prediccion/calendario", label: "Calendario" },
  ...(puede(rol, "modelo") ? [{ href: "/prediccion/modelo", label: "Precisión del modelo" }] : []),
];
