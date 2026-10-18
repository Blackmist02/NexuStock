const db = require('../db');
const { hoy } = require('../lib/dates');
const { getDemandProvider } = require('./demanda');
const { demandaACubrir, nivelPorDemanda, nivelPorMinimo, peorNivel } = require('./reglas');

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
  const hoyIso = hoy();
  return rows.map((r) => {
    const e = estimaciones.get(r.id_producto);
    const demanda = e ? e.demanda : 0;
    const { demanda: reposicion, tope, acotada } = demandaACubrir(demanda, r.lead_time_dias, r.dias_habiles, hoyIso, r.vida_util_dias, r.unidad);
    const nivel = peorNivel(
      nivelPorDemanda(r.stock_actual, reposicion, r.margen_seguridad_pct, tope),
      nivelPorMinimo(r.stock_actual, r.stock_minimo)
    );
    const diaria = demanda / 7;
    return {
      ...r,
      demanda_semana: demanda,
      demanda_reposicion: Math.round(reposicion * 100) / 100,
      reposicion_acotada_vida_util: acotada,
      origen_demanda: e ? e.origen : 'categoria',
      id_modelo: e && e.id_modelo ? e.id_modelo : null,
      latencia_ms: e && e.latencia_ms !== undefined ? e.latencia_ms : null,
      nivel,
      dias_cobertura: diaria > 0 ? Math.floor(r.stock_actual / diaria) : null
    };
  });
}

module.exports = { snapshotInventario };
