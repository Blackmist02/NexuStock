const { Router } = require('express');
const config = require('../config');
const db = require('../db');
const { addDays, hoy, isoWeekday } = require('../lib/dates');
const { snapshotInventario } = require('../services/inventario');
const { ORDEN, cantidadSugerida, fechaLimitePedido, fechaQuiebreEstimada } = require('../services/reglas');

const router = Router();

/** Lunes de la semana de una fecha ISO. */
const lunes = (iso) => addDays(iso, -(isoWeekday(iso) - 1));
const redondear1 = (n) => Math.round(n * 10) / 10;

/**
 * Resumen del dashboard (solo lectura): KPIs, semáforo, tendencia de ventas (8 semanas atrás + 2 adelante),
 * sugerencias de compra con fecha límite de pedido y productos críticos. Las sugerencias se calculan al vuelo
 * con las reglas del diseño; no se escribe nada en ALERTAS_INVENTARIO ni en PREDICCIONES.
 */
router.get('/', async (_req, res) => {
  const hoyIso = hoy();
  const semanas = 8;
  const desde = addDays(lunes(hoyIso), -7 * (semanas - 1));

  const [inventario, ventasHoy, semanal, proyectadas] = await Promise.all([
    snapshotInventario(),
    db.query(
      `SELECT COALESCE(SUM(total_clp), 0)::bigint AS clp, COUNT(*)::int AS tickets
         FROM ventas WHERE (fecha_hora AT TIME ZONE $1)::date = $2::date`,
      [config.tz, hoyIso]
    ),
    db.query(
      `SELECT to_char(date_trunc('week', fecha_hora AT TIME ZONE $1), 'YYYY-MM-DD') AS semana, SUM(cantidad)::float AS real
         FROM ventas
        WHERE (fecha_hora AT TIME ZONE $1)::date >= $2::date
        GROUP BY 1 ORDER BY 1`,
      [config.tz, desde]
    ),
    // Proyecciones ya registradas por el motor (si existen): suma por semana objetivo, la última por producto
    db.query(
      `SELECT semana, SUM(demanda_pred)::float AS proyectada FROM (
         SELECT DISTINCT ON (id_producto, date_trunc('week', fecha_objetivo::timestamp))
                id_producto, to_char(date_trunc('week', fecha_objetivo::timestamp), 'YYYY-MM-DD') AS semana, demanda_pred
           FROM predicciones
          WHERE horizonte = 'semana' AND fecha_objetivo >= $1::date
          ORDER BY id_producto, date_trunc('week', fecha_objetivo::timestamp), generada_en DESC
       ) t GROUP BY semana`,
      [desde]
    )
  ]);

  const semaforo = { quiebre: 0, bajo: 0, optimo: 0, total: inventario.length };
  let valorInventario = 0;
  let demandaSemanaTotal = 0;
  for (const p of inventario) {
    semaforo[p.nivel]++;
    valorInventario += p.stock_actual * p.precio_venta_clp;
    demandaSemanaTotal += p.demanda_semana;
  }

  const real = new Map(semanal.rows.map((r) => [r.semana, r.real]));
  const proy = new Map(proyectadas.rows.map((r) => [r.semana, r.proyectada]));
  const lunesActual = lunes(hoyIso);
  const tendencia = [];
  for (let i = -(semanas - 1); i <= 2; i++) {
    const semana = addDays(lunesActual, 7 * i);
    const futuro = i > 0;
    tendencia.push({
      semana,
      real: futuro ? null : redondear1(real.get(semana) || 0),
      proyectada: proy.has(semana) ? redondear1(proy.get(semana)) : futuro ? redondear1(demandaSemanaTotal) : null,
      es_futuro: futuro
    });
  }

  const enRiesgo = inventario
    .filter((p) => p.nivel !== 'optimo')
    .map((p) => {
      const fechaQuiebre = fechaQuiebreEstimada(hoyIso, p.stock_actual, p.demanda_semana);
      return {
        id_producto: p.id_producto,
        producto: p.nombre,
        categoria: p.categoria,
        unidad: p.unidad,
        nivel: p.nivel,
        stock_actual: p.stock_actual,
        stock_minimo: p.stock_minimo,
        demanda_semana: p.demanda_semana,
        origen_demanda: p.origen_demanda,
        dias_cobertura: p.dias_cobertura,
        proveedor: p.proveedor,
        lead_time_dias: p.lead_time_dias,
        cantidad_sugerida: cantidadSugerida(p.stock_actual, p.demanda_semana, p.margen_seguridad_pct, p.unidad, p.stock_minimo),
        fecha_quiebre_estimada: fechaQuiebre,
        fecha_limite_pedido: fechaLimitePedido(fechaQuiebre, p.lead_time_dias, p.dias_habiles, hoyIso)
      };
    })
    .sort((a, b) => ORDEN[b.nivel] - ORDEN[a.nivel] || a.fecha_limite_pedido.localeCompare(b.fecha_limite_pedido) || a.producto.localeCompare(b.producto));

  res.json({
    generado_en: new Date().toISOString(),
    hoy: hoyIso,
    kpis: {
      valor_inventario_clp: Math.round(valorInventario),
      productos_quiebre: semaforo.quiebre,
      productos_bajo: semaforo.bajo,
      productos_optimo: semaforo.optimo,
      total_productos: semaforo.total,
      ventas_hoy_clp: ventasHoy.rows[0].clp,
      tickets_hoy: ventasHoy.rows[0].tickets
    },
    semaforo,
    tendencia,
    sugerencias: enRiesgo.slice(0, 20),
    productos_criticos: enRiesgo.slice(0, 10)
  });
});

module.exports = router;
