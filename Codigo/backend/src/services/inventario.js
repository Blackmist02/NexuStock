const db = require('../db');
const { getDemandProvider } = require('./demanda');
const { demandaReposicion, nivelPorDemanda, nivelPorMinimo, peorNivel } = require('./reglas');

/** Foto del inventario activo con la demanda semanal proyectada y el semáforo de cada producto (solo lectura). */
async function snapshotInventario(ids = null, opciones = {}) {
  const { rows } = await db.query(
    `SELECT p.id_producto, p.nombre, p.id_categoria, c.nombre AS categoria,
            p.id_proveedor, pr.nombre AS proveedor, p.unidad, p.precio_venta_clp,
            p.stock_actual, p.stock_minimo, p.vida_util_dias, p.margen_seguridad_pct,
            pr.lead_time_dias, pr.dias_habiles
       FROM productos p
       JOIN categorias c   ON c.id_categoria = p.id_categoria
       JOIN proveedores pr ON pr.id_proveedor = p.id_proveedor
      WHERE p.activo AND ($1::bigint[] IS NULL OR p.id_producto = ANY($1::bigint[]))
      ORDER BY p.nombre`,
    [ids]
  );
  const estimaciones = await getDemandProvider().estimar(rows.map((r) => r.id_producto), 'semana', opciones);
  return rows.map((r) => {
    const e = estimaciones.get(r.id_producto);
    const demanda = e ? e.demanda : 0;
    const reposicion = demandaReposicion(demanda, r.lead_time_dias);
    const nivel = peorNivel(
      nivelPorDemanda(r.stock_actual, reposicion, r.margen_seguridad_pct),
      nivelPorMinimo(r.stock_actual, r.stock_minimo)
    );
    const diaria = demanda / 7;
    return {
      ...r,
      demanda_semana: demanda,
      demanda_reposicion: Math.round(reposicion * 100) / 100,
      origen_demanda: e ? e.origen : 'categoria',
      id_modelo: e && e.id_modelo ? e.id_modelo : null,
      latencia_ms: e && e.latencia_ms !== undefined ? e.latencia_ms : null,
      nivel,
      dias_cobertura: diaria > 0 ? Math.floor(r.stock_actual / diaria) : null
    };
  });
}

module.exports = { snapshotInventario };
