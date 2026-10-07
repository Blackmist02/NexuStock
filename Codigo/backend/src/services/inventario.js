const db = require('../db');
const { getDemandProvider } = require('./demanda');
const { nivelPorDemanda, nivelPorMinimo, peorNivel } = require('./reglas');

/** Foto del inventario activo con la demanda semanal proyectada y el semáforo de cada producto (solo lectura). */
async function snapshotInventario() {
  const { rows } = await db.query(
    `SELECT p.id_producto, p.nombre, p.id_categoria, c.nombre AS categoria,
            p.id_proveedor, pr.nombre AS proveedor, p.unidad, p.precio_venta_clp,
            p.stock_actual, p.stock_minimo, p.vida_util_dias, p.margen_seguridad_pct,
            pr.lead_time_dias, pr.dias_habiles
       FROM productos p
       JOIN categorias c   ON c.id_categoria = p.id_categoria
       JOIN proveedores pr ON pr.id_proveedor = p.id_proveedor
      WHERE p.activo
      ORDER BY p.nombre`
  );
  const estimaciones = await getDemandProvider().estimar(rows.map((r) => r.id_producto), 'semana');
  return rows.map((r) => {
    const e = estimaciones.get(r.id_producto);
    const demanda = e ? e.demanda : 0;
    const nivel = peorNivel(
      nivelPorDemanda(r.stock_actual, demanda, r.margen_seguridad_pct),
      nivelPorMinimo(r.stock_actual, r.stock_minimo)
    );
    const diaria = demanda / 7;
    return {
      ...r,
      demanda_semana: demanda,
      origen_demanda: e ? e.origen : 'categoria',
      nivel,
      dias_cobertura: diaria > 0 ? Math.floor(r.stock_actual / diaria) : null
    };
  });
}

module.exports = { snapshotInventario };
