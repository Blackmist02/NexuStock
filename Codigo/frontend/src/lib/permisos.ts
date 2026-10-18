/** Roles definidos en la base de datos (USUARIOS.rol). */
export type Rol = "administrador" | "operador" | "ti";

export const ROL_LABEL: Record<Rol, string> = {
  administrador: "Administrador",
  operador: "Operador",
  ti: "TI",
};

export type Permiso =
  | "movimientos" // registrar ventas y compras
  | "catalogo" // productos, categorías y proveedores
  | "usuarios" // gestionar el equipo y editar la configuración
  | "modelo" // ver la precisión del modelo
  | "registrar_modelo" // registrar y activar versiones del modelo
  | "alertas" // atender o descartar alertas
  | "recalcular" // recalcular predicciones y alertas
  | "calendario" // editar el calendario de eventos
  | "importar" // cargar ventas, compras y mermas desde CSV
  | "fecha_sistema"; // cambiar la fecha de referencia del sistema

/** Misma matriz que aplica la API (middleware requireRole); aquí solo decide qué botones se muestran. */
const MATRIZ: Record<Permiso, readonly Rol[]> = {
  movimientos: ["administrador", "operador"],
  catalogo: ["administrador", "ti"],
  usuarios: ["administrador", "ti"],
  modelo: ["administrador", "ti"],
  registrar_modelo: ["ti"],
  alertas: ["administrador"],
  recalcular: ["administrador", "ti"],
  calendario: ["administrador", "ti"],
  importar: ["administrador"],
  fecha_sistema: ["administrador", "ti"],
};

export const puede = (rol: Rol | undefined | null, permiso: Permiso): boolean => !!rol && MATRIZ[permiso].includes(rol);

/** Filas de la tabla «Permisos por rol» de Configuración. */
export const FILAS_PERMISOS: { texto: string; roles: readonly Rol[] }[] = [
  { texto: "Ver inventario y predicción", roles: ["administrador", "operador", "ti"] },
  { texto: "Registrar compras y ventas", roles: MATRIZ.movimientos },
  { texto: "Editar productos y proveedores", roles: MATRIZ.catalogo },
  { texto: "Atender o descartar alertas", roles: MATRIZ.alertas },
  { texto: "Gestionar usuarios", roles: MATRIZ.usuarios },
  { texto: "Ver precisión del modelo", roles: MATRIZ.modelo },
  { texto: "Registrar y activar modelos", roles: MATRIZ.registrar_modelo },
  { texto: "Cargar ventas, compras y mermas (CSV)", roles: MATRIZ.importar },
  { texto: "Cambiar la fecha del sistema", roles: MATRIZ.fecha_sistema },
];
