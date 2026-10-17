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
const { hoy } = require('../lib/dates');
const { fechaObjetivo, modeloDisponible, predecirConModelo } = require('./prediccion');

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

/** Ejecuta `tarea` sobre cada elemento con a lo más `n` en paralelo (el motor no debe saturar el servidor). */
async function conConcurrencia(items, n, tarea) {
  const cola = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, cola.length) }, async () => {
      while (cola.length) await tarea(cola.shift());
    })
  );
}

/**
 * Proveedor por defecto: usa el modelo activo (origen «modelo») cuando existe y responde; en cualquier otro caso
 * —sin modelo, script caído, más de 2 s, valor inválido o producto sin historial— aplica el respaldo (RF-11).
 *
 * `ejecutar: false` (lecturas como el dashboard) solo reutiliza las predicciones del modelo ya registradas hoy;
 * `ejecutar: true` (motor de alertas, «generar predicción») invoca el script para los productos que falten.
 */
const compuesto = {
  async estimar(productoIds, horizonte = 'semana', { ejecutar = false } = {}) {
    const out = await promedioHistorico.estimar(productoIds, horizonte);
    let modelo = null;
    try {
      modelo = await modeloDisponible();
    } catch (e) {
      console.error('[demanda] no se pudo consultar el modelo activo:', e.message);
    }
    if (!modelo || out.size === 0) return out;

    const ids = [...out.keys()];
    const { rows } = await db.query(
      `SELECT DISTINCT ON (id_producto) id_producto, demanda_pred::float AS demanda, id_modelo, latencia_ms
         FROM predicciones
        WHERE id_producto = ANY($1::bigint[]) AND horizonte = $2 AND fecha_objetivo = $3::date
          AND origen = 'modelo' AND id_modelo = $4 AND (generada_en AT TIME ZONE $5)::date = $6::date
        ORDER BY id_producto, generada_en DESC`,
      [ids, horizonte, fechaObjetivo(horizonte), modelo.id_modelo, config.tz, hoy()]
    );
    for (const r of rows) out.set(r.id_producto, { demanda: r.demanda, origen: 'modelo', id_modelo: r.id_modelo, latencia_ms: r.latencia_ms });
    if (!ejecutar) return out;

    // Solo productos con historial propio (los nuevos se estiman por categoría) y sin predicción vigente de hoy
    const reutilizados = new Set(rows.map((r) => r.id_producto));
    const pendientes = ids.filter((id) => !reutilizados.has(id) && out.get(id).origen === 'promedio_historico');
    if (!pendientes.length) return out;
    const info = await db.query(
      `SELECT p.id_producto, p.nombre, p.unidad, c.nombre AS categoria
         FROM productos p JOIN categorias c ON c.id_categoria = p.id_categoria WHERE p.id_producto = ANY($1::bigint[])`,
      [pendientes]
    );
    await conConcurrencia(info.rows, 3, async (prod) => {
      try {
        out.set(prod.id_producto, await predecirConModelo(prod, horizonte, modelo));
      } catch (e) {
        console.warn(`[demanda] respaldo para el producto ${prod.id_producto}: ${e.message}`);
      }
    });
    return out;
  }
};

let proveedor = compuesto;
const getDemandProvider = () => proveedor;
const setDemandProvider = (p) => {
  proveedor = p;
};

module.exports = { getDemandProvider, setDemandProvider, promedioHistorico, compuesto };
