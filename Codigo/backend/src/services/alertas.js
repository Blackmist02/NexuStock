/**
 * Registro e historial de ALERTAS_INVENTARIO (CU-09 y CU-05, MotorAlertasService).
 *
 * Cada vez que se calcula el semáforo se sincronizan las alertas activas:
 *  - producto en quiebre o bajo, sin alerta activa      → nueva alerta (fotografía de stock, demanda y sugerencia)
 *  - producto en riesgo con alerta activa de otro nivel → la anterior se cierra (descartada) y se crea la nueva
 *  - producto óptimo con alerta activa                  → la alerta queda atendida (el stock se repuso)
 * El administrador también puede atender o descartar una alerta activa a mano.
 *
 * demanda_proyectada guarda la demanda del horizonte de reposición (lead time + 1 día), que es la que
 * compara el semáforo; con ella y el margen se deduce la causa de cada alerta sin columnas adicionales.
 */
const config = require('../config');
const db = require('../db');
const { momentoSql, semanaObjetivo } = require('../lib/dates');

const CAUSAS = {
  sin_stock: 'Sin stock',
  demanda_reposicion: 'El stock no alcanza para la demanda hasta la próxima entrega (lead time + 1 día)',
  margen_seguridad: 'El stock cubre la demanda hasta la próxima entrega, pero no el margen de seguridad',
  stock_minimo: 'El stock está bajo el mínimo definido para el producto'
};

/** Causa de una alerta a partir de su fotografía (función pura). */
function causaAlerta({ stock_actual: stock, demanda_proyectada: demanda, margen_seguridad_pct: margen }) {
  if (stock <= 0) return 'sin_stock';
  if (stock < demanda) return 'demanda_reposicion';
  if (stock < demanda * (1 + margen / 100)) return 'margen_seguridad';
  return 'stock_minimo';
}

/**
 * Sincroniza las alertas con el semáforo actual. `productos`: un elemento por producto activo con
 * id_producto, id_proveedor, nivel, stock_actual, demanda_reposicion, margen_seguridad_pct, cantidad_sugerida,
 * lead_time_dias, fecha_quiebre_estimada y fecha_limite_pedido.
 */
async function sincronizarAlertas(productos, hoyIso) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Una sincronización a la vez: dos cargas simultáneas del dashboard no duplican alertas
    await client.query("SELECT pg_advisory_xact_lock(hashtext('alertas_inventario'))");
    const momento = (await client.query(`SELECT ${momentoSql('$1', '$2')} AS m`, [config.fechaReferencia || null, config.tz]))
      .rows[0].m;
    const activas = (await client.query(`SELECT id_alerta, id_producto, nivel FROM alertas_inventario WHERE estado = 'activa'`))
      .rows;

    const nivelDe = new Map(productos.map((p) => [p.id_producto, p.nivel]));
    const atendidas = [];
    const reemplazadas = [];
    const conAlertaVigente = new Set();
    for (const a of activas) {
      const nivel = nivelDe.get(a.id_producto);
      if (nivel === undefined) continue; // producto inactivo: la alerta queda como está
      if (nivel === 'optimo') atendidas.push(a.id_alerta);
      else if (nivel !== a.nivel) reemplazadas.push(a.id_alerta);
      else conAlertaVigente.add(a.id_producto);
    }
    const nuevas = productos.filter((p) => p.nivel !== 'optimo' && !conAlertaVigente.has(p.id_producto));

    const cerrar = (ids, estado) =>
      ids.length
        ? client.query(
            `UPDATE alertas_inventario SET estado = $2, resuelta_en = $3 WHERE id_alerta = ANY($1::bigint[])`,
            [ids, estado, momento]
          )
        : null;
    await cerrar(atendidas, 'atendida');
    await cerrar(reemplazadas, 'descartada');

    if (nuevas.length) {
      const col = (k) => nuevas.map((p) => p[k]);
      await client.query(
        `INSERT INTO alertas_inventario (id_producto, id_proveedor, id_prediccion, nivel, stock_actual, demanda_proyectada,
                                         margen_seguridad_pct, cantidad_sugerida, lead_time_dias,
                                         fecha_quiebre_estimada, fecha_limite_pedido, creada_en)
         SELECT n.id_producto, n.id_proveedor,
                (SELECT pr.id_prediccion FROM predicciones pr
                  WHERE pr.id_producto = n.id_producto AND pr.horizonte = 'semana' AND pr.fecha_objetivo = $11::date
                  ORDER BY (pr.origen = 'modelo') DESC, pr.generada_en DESC LIMIT 1),
                n.nivel, n.stock, n.demanda, n.margen, n.cantidad, n.lead, n.quiebre, n.limite, $12
           FROM unnest($1::bigint[], $2::bigint[], $3::varchar[], $4::numeric[], $5::numeric[], $6::numeric[],
                       $7::numeric[], $8::smallint[], $9::date[], $10::date[])
                AS n(id_producto, id_proveedor, nivel, stock, demanda, margen, cantidad, lead, quiebre, limite)`,
        [
          col('id_producto'),
          col('id_proveedor'),
          col('nivel'),
          col('stock_actual'),
          nuevas.map((p) => Math.round(p.demanda_reposicion * 100) / 100),
          col('margen_seguridad_pct'),
          col('cantidad_sugerida'),
          col('lead_time_dias'),
          col('fecha_quiebre_estimada'),
          col('fecha_limite_pedido'),
          semanaObjetivo(hoyIso),
          momento
        ]
      );
    }
    await client.query('COMMIT');
    return { nuevas: nuevas.length, atendidas: atendidas.length, reemplazadas: reemplazadas.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Historial de alertas con su causa, del más reciente al más antiguo. */
async function listarAlertas({ estado, nivel, limite = 300 } = {}) {
  const { rows } = await db.query(
    `SELECT a.id_alerta, a.id_producto, p.nombre AS producto, c.nombre AS categoria, p.unidad, pr.nombre AS proveedor,
            a.nivel, a.estado, a.stock_actual, a.demanda_proyectada, a.margen_seguridad_pct, a.cantidad_sugerida,
            a.lead_time_dias, to_char(a.fecha_quiebre_estimada, 'YYYY-MM-DD') AS fecha_quiebre_estimada,
            to_char(a.fecha_limite_pedido, 'YYYY-MM-DD') AS fecha_limite_pedido, a.creada_en, a.resuelta_en,
            pd.origen AS origen_demanda,
            (a.estado = 'descartada' AND EXISTS (
               SELECT 1 FROM alertas_inventario b
                WHERE b.id_producto = a.id_producto AND b.id_alerta <> a.id_alerta AND b.creada_en = a.resuelta_en
            )) AS reemplazada
       FROM alertas_inventario a
       JOIN productos p    ON p.id_producto = a.id_producto
       JOIN categorias c   ON c.id_categoria = p.id_categoria
       JOIN proveedores pr ON pr.id_proveedor = a.id_proveedor
       LEFT JOIN predicciones pd ON pd.id_prediccion = a.id_prediccion
      WHERE ($1::varchar IS NULL OR a.estado = $1) AND ($2::varchar IS NULL OR a.nivel = $2)
      ORDER BY a.creada_en DESC, a.id_alerta DESC
      LIMIT $3`,
    [estado || null, nivel || null, limite]
  );
  const resumen = await db.query(`SELECT estado, COUNT(*)::int AS n FROM alertas_inventario GROUP BY estado`);
  return {
    resumen: Object.fromEntries(['activa', 'atendida', 'descartada'].map((e) => [e, 0]).concat(resumen.rows.map((r) => [r.estado, r.n]))),
    alertas: rows.map((a) => {
      const causa = causaAlerta(a);
      return { ...a, causa, causa_texto: CAUSAS[causa] };
    })
  };
}

/** Atiende o descarta una alerta activa (acción del administrador). Devuelve null si no existe o ya estaba cerrada. */
async function resolverAlerta(id, estado) {
  const { rows } = await db.query(
    `UPDATE alertas_inventario SET estado = $2, resuelta_en = ${momentoSql('$3', '$4')}
      WHERE id_alerta = $1 AND estado = 'activa'
      RETURNING id_alerta, estado, resuelta_en`,
    [id, estado, config.fechaReferencia || null, config.tz]
  );
  return rows[0] || null;
}

module.exports = { CAUSAS, causaAlerta, sincronizarAlertas, listarAlertas, resolverAlerta };
