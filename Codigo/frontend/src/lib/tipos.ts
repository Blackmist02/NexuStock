/** Tipos de las respuestas de la API (ver backend/README.md). */
import type { Nivel } from "./format";
import type { Rol } from "./permisos";

export type Unidad = "kg" | "un";
export type OrigenDemanda = "modelo" | "promedio_historico" | "categoria";

export const ORIGEN_LABEL: Record<OrigenDemanda, string> = {
  modelo: "Modelo ML",
  promedio_historico: "Promedio histórico",
  categoria: "Estimado por categoría",
};

export interface ProductoFila {
  id_producto: number;
  nombre: string;
  id_categoria: number;
  categoria: string;
  id_proveedor: number;
  proveedor: string;
  unidad: Unidad;
  precio_venta_clp: number;
  stock_actual: number;
  stock_minimo: number;
  vida_util_dias: number | null;
  margen_seguridad_pct: number;
  activo: boolean;
  lead_time_dias: number;
  ultima_compra: string | null;
  ultima_venta: string | null;
  nivel: Nivel | null;
  demanda_semana: number | null;
  origen_demanda: OrigenDemanda | null;
  dias_cobertura: number | null;
}

export interface ListaProductos {
  data: ProductoFila[];
  resumen: { total: number; quiebre: number; bajo: number; optimo: number };
  actualizado_en: string;
}

export interface Movimiento {
  fecha_hora: string;
  tipo: "venta" | "compra" | "merma";
  id_producto?: number;
  producto?: string;
  unidad?: Unidad;
  cantidad: number;
  monto_clp: number;
  usuario: string;
  proveedor: string | null;
}

export interface DetalleProducto extends ProductoFila {
  /** Fecha del sistema (AAAA-MM-DD) con la que se calculó la sugerencia. */
  hoy?: string;
  valor_stock_clp: number;
  sugerencia: { cantidad_sugerida: number; fecha_quiebre_estimada: string; fecha_limite_pedido: string } | null;
  serie_30d: { fecha: string; compras: number; ventas: number }[];
  movimientos: Movimiento[];
}

export interface Categoria {
  id_categoria: number;
  nombre: string;
  productos: number;
}

export interface Proveedor {
  id_proveedor: number;
  nombre: string;
  contacto: string | null;
  lead_time_dias: number;
  dias_habiles: number[];
  activo: boolean;
  productos: number;
  compras_30d_clp: number;
}

export interface Alerta {
  id_alerta: number;
  id_producto: number;
  producto: string;
  unidad: Unidad;
  categoria: string;
  id_proveedor: number;
  proveedor: string;
  nivel: Nivel;
  estado: "activa" | "atendida" | "descartada";
  stock_actual: number;
  demanda_proyectada: number;
  margen_seguridad_pct: number;
  cantidad_sugerida: number;
  lead_time_dias: number;
  fecha_quiebre_estimada: string;
  fecha_limite_pedido: string;
  creada_en: string;
  resuelta_en: string | null;
  origen_demanda: OrigenDemanda | null;
  /** Causa deducida de la fotografía de la alerta (stock, demanda hasta la próxima entrega y margen). */
  causa: "sin_stock" | "demanda_reposicion" | "margen_seguridad" | "stock_minimo";
  causa_texto: string;
}

export interface Evento {
  id_evento: number | null;
  fecha: string;
  nombre: string;
  tipo: "fiestas_patrias" | "semana_santa" | "feriado_largo" | "feriado" | "otro" | "quincena" | "fin_de_mes";
  derivado: boolean;
}

export interface UsuarioFila {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
  creado_en: string;
}

export interface Modelo {
  id_modelo: number;
  algoritmo: string;
  version: string;
  mae_general: number;
  mae_festivos: number | null;
  entrenado_desde: string;
  entrenado_hasta: string;
  prueba_desde: string;
  prueba_hasta: string;
  artefacto_ruta: string;
  activo: boolean;
  creado_en: string;
}

export interface ConfigFecha {
  hoy: string;
  referencia: string | null;
  origen: "real" | "base" | "entorno";
  real: string;
  ultimos_movimientos: { venta: string | null; compra: string | null; merma: string | null };
  minima: string | null;
}

export interface ConfigNegocio {
  negocio: { nombre: string };
  alertas: { quiebre: boolean; bajo: boolean };
  fecha: ConfigFecha;
}
