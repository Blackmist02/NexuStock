/** Roles definidos en la base de datos (USUARIOS.rol). */
export type Rol = "administrador" | "operador" | "ti";

export const ROL_LABEL: Record<Rol, string> = {
  administrador: "Administrador",
  operador: "Operador",
  ti: "TI",
};
