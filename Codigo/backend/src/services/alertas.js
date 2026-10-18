/**
 * MotorAlertasService (RF-09, RF-10, RF-05): evalúa el semáforo de cada producto, registra la proyección usada y
 * crea o actualiza la alerta activa del producto sin duplicarla.
 *
 * El semáforo y la cantidad sugerida usan la demanda del horizonte de reposición (lead time + 1 día), que es la que
 * se guarda en demanda_proyectada; con ella y el margen se deduce la causa de cada alerta (control de cambios ERS v02).
 * Las fechas de creación y resolución respetan FECHA_REFERENCIA cuando se muestran datos históricos.
 */
const config = require('../config');
const db = require('../db');
const { ApiError } = require('../lib/errors');
const { addDays, hoy, momentoSql } = require('../lib/dates');
const negocio = require('../lib/negocio');
const { withTransaction } = require('../lib/tx');
const { fechaObjetivo } = require('./prediccion');
const { snapshotInventario } = require('./inventario');
const {
  ORDEN, acotarPorVidaUtil, cantidadSugerida, fechaLimitePedido, fechaQuiebreEstimada
} = require('./reglas');

const CAUSAS = {
  sin_stock: 'Sin stock',
  demanda_reposicion: 'El stock no alcanza para la demanda hasta la próxima entrega (lead time + 1 día)',
  margen_seguridad: 'El stock cubre la demanda hasta la próxima entrega, pero no el margen de seguridad',
  stock_minimo: 'El stock está bajo el mínimo definido para el producto'
};

/** Causa de una alerta a partir de su fotografía: stock, demanda de reposición y margen (función pura). */
function causaAlerta({ stock_actual: stock, demanda_proyectada: demanda, margen_seguridad_pct: margen }) {
  if (stock <= 0) return 'sin_stock';
  if (stock < demanda) return 'demanda_reposicion';
  if (stock < demanda * (1 + margen / 100)) return 'margen_seguridad';
  return 'stock_minimo';
}

/** Instante actual del negocio (respeta FECHA_REFERENCIA). */
async function momento(client = db) {
  return (await client.query(`SELECT ${momentoSql('$1', '$2')} AS m`, [config.fechaReferencia || null, config.tz])).rows[0].m;
}

/**
 * Sugerencia de compra de un producto del inventario: demanda del horizonte de reposición (lead time + 1 día),
 * cantidad acotada para que el stock resultante se venda dentro de la vida útil, y fechas de quiebre y de pedido.
 */
function sugerenciaDe(p, hoyIso) {
  const fechaQuiebre = fechaQuiebreEstimada(hoyIso, p.stock_actual, p.demanda_semana);
  const bruta = cantidadSugerida(p.stock_actual, p.demanda_reposicion, p.margen_seguridad_pct, p.unidad, p.stock_minimo);
  const { cantidad, acotada } = acotarPorVidaUtil(bruta, p.demanda_semana, p.vida_util_dias, p.unidad, p.stock_actual);
  return {
    id_producto: p.id_producto,
    producto: p.nombre,
    categoria: p.categoria,
    unidad: p.unidad,
    nivel: p.nivel,
    stock_actual: p.stock_actual,
    stock_minimo: p.stock_minimo,
    margen_seguridad_pct: p.margen_seguridad_pct,
    demanda_semana: p.demanda_semana,
    demanda_reposicion: p.demanda_reposicion,
    origen_demanda: p.origen_demanda,
    dias_cobertura: p.dias_cobertura,
    id_proveedor: p.id_proveedor,
    proveedor: p.proveedor,
    lead_time_dias: p.lead_time_dias,
    cantidad_sugerida: cantidad,
    cantidad_acotada_vida_util: acotada,
    fecha_quiebre_estimada: fechaQuiebre,
    fecha_limite_pedido: fechaLimitePedido(fechaQuiebre, p.lead_time_dias, p.dias_habiles, hoyIso)
  };
}

/** Productos en riesgo (quiebre o bajo) con su sugerencia, ordenados por nivel y fecha límite (solo cálculo). */
function calcularRiesgos(inventario, hoyIso = hoy()) {
  return inventario
    .filter((p) => p.nivel !== 'optimo')
    .map((p) => sugerenciaDe(p, hoyIso))
    .sort(
      (a, b) =>
        ORDEN[b.nivel] - ORDEN[a.nivel] ||
        a.fecha_limite_pedido.localeCompare(b.fecha_limite_pedido) ||
        a.producto.localeCompare(b.producto)
    );
}

/** RF-10: una sola predicción por producto, horizonte y fecha objetivo; un nuevo cálculo reemplaza al anterior. */
async function registrarPrediccion(client, { id_producto, id_modelo = null, horizonte = 'semana', demanda, origen, latencia_ms = null }) {
  const objetivo = fechaObjetivo(horizonte);
  const valor = Math.max(0, Math.round(demanda * 100) / 100);
  const upd = await client.query(
    `UPDATE predicciones SET id_modelo = $4, demanda_pred = $5, origen = $6, latencia_ms = $7, generada_en = NOW()
      WHERE id_prediccion = (SELECT id_prediccion FROM predicciones
                              WHERE id_producto = $1 AND horizonte = $2 AND fecha_objetivo = $3::date
                              ORDER BY generada_en DESC LIMIT 1)
      RETURNING id_prediccion`,
    [id_producto, horizonte, objetivo, origen === 'modelo' ? id_modelo : null, valor, origen, latencia_ms]
  );
  if (upd.rowCount) return upd.rows[0].id_prediccion;
  const ins = await client.query(
    `INSERT INTO predicciones (id_producto, id_modelo, horizonte, fecha_objetivo, demanda_pred, origen, latencia_ms)
     VALUES ($1, $2, $3, $4::date, $5, $6, $7) RETURNING id_prediccion`,
    [id_producto, origen === 'modelo' ? id_modelo : null, horizonte, objetivo, valor, origen, latencia_ms]
  );
  return ins.rows[0].id_prediccion;
}

/**
 * Evalúa los productos indicados (o todos los activos): registra la proyección (RF-10) y actualiza las alertas (RF-09).
 *  - producto en quiebre/bajo → crea la alerta activa o actualiza la existente (no se duplica);
 *  - producto óptimo → sus alertas activas se cierran como «atendida» (el riesgo ya no existe);
 *  - si el administrador descartó una alerta del producto en las últimas 24 h, no se vuelve a crear con el mismo nivel o menor;
 *  - los niveles desactivados en «Configuración» no generan alertas.
 */
async function evaluar({ productoIds = null } = {}) {
  const hoyIso = hoy();
  const inventario = await snapshotInventario(productoIds, { ejecutar: true });
  const cfg = negocio.leer();
  const resumen = { evaluados: inventario.length, creadas: 0, actualizadas: 0, cerradas: 0, productos: [] };

  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7001)'); // evita evaluaciones simultáneas duplicando alertas
    const ahora = await momento(client);
    for (const p of inventario) {
      const idPred = await registrarPrediccion(client, {
        id_producto: p.id_producto,
        id_modelo: p.id_modelo,
        demanda: p.demanda_semana,
        origen: p.origen_demanda,
        latencia_ms: p.latencia_ms
      });
      const activa = (
        await client.query(
          `SELECT id_alerta FROM alertas_inventario WHERE id_producto = $1 AND estado = 'activa' ORDER BY creada_en DESC`,
          [p.id_producto]
        )
      ).rows;

      if (p.nivel === 'optimo') {
        if (activa.length) {
          await client.query(
            `UPDATE alertas_inventario SET estado = 'atendida', resuelta_en = $2 WHERE id_producto = $1 AND estado = 'activa'`,
            [p.id_producto, ahora]
          );
          resumen.cerradas += activa.length;
        }
        resumen.productos.push({ id_producto: p.id_producto, nivel: 'optimo', alerta: null });
        continue;
      }

      const s = sugerenciaDe(p, hoyIso);
      const valores = [
        p.nivel, p.stock_actual, p.demanda_reposicion, p.margen_seguridad_pct, s.cantidad_sugerida,
        p.lead_time_dias, s.fecha_quiebre_estimada, s.fecha_limite_pedido, p.id_proveedor, idPred
      ];
      if (activa.length) {
        await client.query(
          `UPDATE alertas_inventario
              SET nivel = $1, stock_actual = $2, demanda_proyectada = $3, margen_seguridad_pct = $4, cantidad_sugerida = $5,
                  lead_time_dias = $6, fecha_quiebre_estimada = $7::date, fecha_limite_pedido = $8::date, id_proveedor = $9, id_prediccion = $10
            WHERE id_alerta = $11`,
          [...valores, activa[0].id_alerta]
        );
        // si había varias activas (no debería), se cierran las sobrantes
        if (activa.length > 1) {
          await client.query(
            `UPDATE alertas_inventario SET estado = 'atendida', resuelta_en = $2 WHERE id_alerta = ANY($1::bigint[])`,
            [activa.slice(1).map((a) => a.id_alerta), ahora]
          );
        }
        resumen.actualizadas++;
        resumen.productos.push({ id_producto: p.id_producto, nivel: p.nivel, alerta: activa[0].id_alerta });
        continue;
      }
      if (cfg.alertas[p.nivel] === false) {
        resumen.productos.push({ id_producto: p.id_producto, nivel: p.nivel, alerta: null });
        continue;
      }
      const descartada = (
        await client.query(
          `SELECT nivel FROM alertas_inventario
            WHERE id_producto = $1 AND estado = 'descartada' AND resuelta_en > $2::timestamptz - interval '24 hours'
            ORDER BY resuelta_en DESC LIMIT 1`,
          [p.id_producto, ahora]
        )
      ).rows[0];
      if (descartada && ORDEN[p.nivel] <= ORDEN[descartada.nivel]) {
        resumen.productos.push({ id_producto: p.id_producto, nivel: p.nivel, alerta: null });
        continue;
      }
      const ins = await client.query(
        `INSERT INTO alertas_inventario
           (id_producto, nivel, stock_actual, demanda_proyectada, margen_seguridad_pct, cantidad_sugerida, lead_time_dias,
            fecha_quiebre_estimada, fecha_limite_pedido, id_proveedor, id_prediccion, creada_en)
         VALUES ($11, $1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $12) RETURNING id_alerta`,
        [...valores, p.id_producto, ahora]
      );
      resumen.creadas++;
      resumen.productos.push({ id_producto: p.id_producto, nivel: p.nivel, alerta: ins.rows[0].id_alerta });
    }
  });
  return resumen;
}

/** Evaluación sin bloquear ni romper la operación que la dispara (venta, compra, alta de producto). */
async function evaluarSinFallar(productoIds) {
  try {
    const r = await evaluar({ productoIds });
    return r.productos[0] || null;
  } catch (e) {
    console.error('[alertas] no se pudo evaluar el inventario:', e.message);
    return null;
  }
}

const SELECT_ALERTA = `
  SELECT a.id_alerta, a.id_producto, p.nombre AS producto, p.unidad, c.nombre AS categoria,
         a.id_proveedor, pr.nombre AS proveedor, a.nivel, a.estado,
         a.stock_actual, a.demanda_proyectada, a.margen_seguridad_pct, a.cantidad_sugerida, a.lead_time_dias,
         to_char(a.fecha_quiebre_estimada, 'YYYY-MM-DD') AS fecha_quiebre_estimada,
         to_char(a.fecha_limite_pedido, 'YYYY-MM-DD') AS fecha_limite_pedido,
         a.creada_en, a.resuelta_en, pd.origen AS origen_demanda
    FROM alertas_inventario a
    JOIN productos p ON p.id_producto = a.id_producto
    JOIN categorias c ON c.id_categoria = p.id_categoria
    JOIN proveedores pr ON pr.id_proveedor = a.id_proveedor
    LEFT JOIN predicciones pd ON pd.id_prediccion = a.id_prediccion`;

const conCausa = (a) => {
  const causa = causaAlerta(a);
  return { ...a, causa, causa_texto: CAUSAS[causa] };
};

/**
 * Alertas con su causa. Las activas se ordenan por riesgo y fecha límite de pedido; el historial (atendidas,
 * descartadas o todas) por fecha de creación, de la más reciente a la más antigua.
 */
async function listar({ estado = 'activa' } = {}) {
  const orden =
    estado === 'activa'
      ? `CASE a.nivel WHEN 'quiebre' THEN 0 WHEN 'bajo' THEN 1 ELSE 2 END, a.fecha_limite_pedido, p.nombre`
      : 'a.creada_en DESC, a.id_alerta DESC';
  const { rows } = await db.query(
    `${SELECT_ALERTA}
      WHERE ($1::text IS NULL OR a.estado = $1)
      ORDER BY ${orden}
      LIMIT 500`,
    [estado === 'todas' ? null : estado]
  );
  return rows.map(conCausa);
}

/** RF-05: marca la alerta como atendida o descartada y registra el momento. Una alerta ya resuelta no se vuelve a resolver. */
async function resolver(idAlerta, estado) {
  const r = await db.query(
    `UPDATE alertas_inventario SET estado = $2, resuelta_en = $3 WHERE id_alerta = $1 AND estado = 'activa' RETURNING id_alerta`,
    [idAlerta, estado, await momento()]
  );
  if (r.rowCount === 0) {
    const e = await db.query('SELECT estado FROM alertas_inventario WHERE id_alerta = $1', [idAlerta]);
    if (!e.rowCount) throw new ApiError(404, 'no_encontrada', 'La alerta no existe');
    throw new ApiError(409, 'ya_resuelta', `La alerta ya fue ${e.rows[0].estado === 'atendida' ? 'atendida' : 'descartada'}. Actualizamos el listado.`);
  }
  return conCausa((await db.query(`${SELECT_ALERTA} WHERE a.id_alerta = $1`, [idAlerta])).rows[0]);
}

module.exports = {
  CAUSAS,
  causaAlerta,
  calcularRiesgos,
  sugerenciaDe,
  registrarPrediccion,
  evaluar,
  evaluarSinFallar,
  listar,
  resolver
};
