/**
 * Fuente de demanda proyectada. El dashboard solo depende de la función `estimar` de un «proveedor de demanda»:
 *
 *   estimar(productoIds, horizonte) → Map<id_producto, { demanda, origen }>
 *
 * Hoy la única implementación es el respaldo estadístico del diseño (`promedio_historico` y, sin historial,
 * `categoria`). Cuando el motor de ML esté listo, se agrega otro proveedor con origen = 'modelo' y se registra
 * con setDemandProvider().
 */
const config = require('../config');
const db = require('../db');

const DIAS = { semana: 7, mes: 30 };
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const promedioHistorico = {
  /**
   * Demanda diaria = ventas de las últimas N semanas ÷ días con historial real (mín. 7, máx. N·7),
   * escalada al horizonte. Sin historial → promedio de la categoría.
   */
  async estimar(productoIds, horizonte = 'semana') {
    const semanas = config.demandaSemanasHistorial;
    const { rows } = await db.query(
      `SELECT p.id_producto, p.id_categoria,
              (SELECT MIN(v.fecha_hora) FROM ventas v WHERE v.id_producto = p.id_producto) AS primera_venta,
              COALESCE((SELECT SUM(v.cantidad) FROM ventas v
                         WHERE v.id_producto = p.id_producto
                           AND v.fecha_hora >= NOW() - make_interval(weeks => $1)), 0) AS total,
              EXTRACT(EPOCH FROM (NOW() - (SELECT MIN(v.fecha_hora) FROM ventas v
                                            WHERE v.id_producto = p.id_producto))) / 86400.0 AS dias_historial
         FROM productos p
        WHERE p.activo`,
      [semanas]
    );

    const dias = DIAS[horizonte];
    const diaria = new Map(); // null = sin historial
    for (const r of rows) {
      if (r.primera_venta === null) {
        diaria.set(r.id_producto, null);
        continue;
      }
      const efectivos = Math.min(semanas * 7, Math.max(7, Math.ceil(Number(r.dias_historial))));
      diaria.set(r.id_producto, Number(r.total) / efectivos);
    }

    const porCategoria = new Map();
    for (const r of rows) {
      const d = diaria.get(r.id_producto);
      if (d === null || d === undefined) continue;
      porCategoria.set(r.id_categoria, [...(porCategoria.get(r.id_categoria) || []), d]);
    }
    const promedioCategoria = (idCat) => {
      const arr = porCategoria.get(idCat);
      return arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    };

    const out = new Map();
    const categoriaDe = new Map(rows.map((r) => [r.id_producto, r.id_categoria]));
    for (const id of productoIds) {
      if (!categoriaDe.has(id)) continue; // inactivo o inexistente
      const d = diaria.get(id);
      out.set(
        id,
        d === null || d === undefined
          ? { demanda: round2(promedioCategoria(categoriaDe.get(id)) * dias), origen: 'categoria' }
          : { demanda: round2(d * dias), origen: 'promedio_historico' }
      );
    }
    return out;
  }
};

let proveedor = promedioHistorico;
const getDemandProvider = () => proveedor;
const setDemandProvider = (p) => {
  proveedor = p;
};

module.exports = { getDemandProvider, setDemandProvider, promedioHistorico };
