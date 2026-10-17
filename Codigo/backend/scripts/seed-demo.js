/**
 * Datos de ejemplo para probar NexuStock (proveedores, productos y ~10 semanas de ventas y compras).
 * Uso:  npm run seed:demo        (necesita al menos una cuenta creada; se aborta si ya hay productos)
 *       npm run seed:demo -- --force   (agrega los datos aunque ya existan productos)
 * No modifica el esquema de la base de datos.
 */
require('dotenv').config({ quiet: true });
const db = require('../src/db');

const PROVEEDORES = [
  ['Distribuidora Agrocarnes', 'Marcela Soto', 1, [1, 2, 3, 4, 5]],
  ['Frigorífico Los Andes', 'Pedro Villalobos', 2, [1, 2, 3, 4, 5, 6]],
  ['Avícola San José', 'Camila Rojas', 1, [1, 2, 3, 4, 5, 6]],
  ['Embutidos Casa Lagos', 'Luis Lagos', 3, [1, 2, 3, 4, 5]]
];
// nombre, categoría, proveedor (índice), unidad, precio, stock mínimo, vida útil, venta diaria media (kg), stock inicial
const PRODUCTOS = [
  ['Lomo vetado', 'Vacuno', 0, 'kg', 12990, 5, 5, 2.0, 1.2],
  ['Asado de tira', 'Vacuno', 0, 'kg', 9490, 8, 5, 1.3, 6],
  ['Chorizo', 'Embutidos', 3, 'kg', 5990, 6, 10, 1.4, 4],
  ['Posta rosada', 'Vacuno', 1, 'kg', 8990, 9, 5, 1.0, 8],
  ['Costillar', 'Cerdo', 0, 'kg', 7290, 8, 5, 0.9, 14.5],
  ['Carne molida', 'Vacuno', 0, 'kg', 6490, 10, 3, 3.0, 22],
  ['Pollo entero', 'Pollo', 2, 'kg', 3490, 10, 4, 2.6, 18],
  ['Punta paleta', 'Vacuno', 1, 'kg', 9790, 7, 5, 1.1, 11]
];

// Generador pseudoaleatorio con semilla fija para que los datos sean reproducibles
let semilla = 20261016;
const rnd = () => ((semilla = (semilla * 1664525 + 1013904223) % 4294967296) / 4294967296);

async function main() {
  const force = process.argv.includes('--force');
  const usuario = (await db.query('SELECT id_usuario FROM usuarios ORDER BY id_usuario LIMIT 1')).rows[0];
  if (!usuario) throw new Error('Crea primero una cuenta (pantalla «Crear cuenta») y vuelve a ejecutar el script.');
  const existentes = (await db.query('SELECT COUNT(*)::int AS n FROM productos')).rows[0].n;
  if (existentes > 0 && !force) throw new Error('Ya hay productos registrados. Usa --force para agregar los datos de ejemplo de todos modos.');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const idProv = [];
    for (const [nombre, contacto, lead, dias] of PROVEEDORES) {
      const r = await client.query(
        `INSERT INTO proveedores (nombre, contacto, lead_time_dias, dias_habiles) VALUES ($1, $2, $3, $4)
         ON CONFLICT (nombre) DO UPDATE SET contacto = EXCLUDED.contacto RETURNING id_proveedor`,
        [nombre, contacto, lead, dias]
      );
      idProv.push(r.rows[0].id_proveedor);
    }
    const hoy = new Date();
    let ventas = 0;
    let compras = 0;
    for (const [nombre, cat, iProv, unidad, precio, minimo, vida, media, stockFinal] of PRODUCTOS) {
      const c = await client.query(
        `INSERT INTO categorias (nombre) VALUES ($1) ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id_categoria`,
        [cat]
      );
      const p = await client.query(
        `INSERT INTO productos (nombre, id_categoria, id_proveedor, unidad, precio_venta_clp, stock_actual, stock_minimo, vida_util_dias, margen_seguridad_pct)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 10) RETURNING id_producto`,
        [nombre, c.rows[0].id_categoria, idProv[iProv], unidad, precio, stockFinal, minimo, vida]
      );
      const id = p.rows[0].id_producto;
      for (let d = 70; d >= 0; d--) {
        const dia = new Date(hoy.getTime() - d * 86400000);
        const finde = [5, 6].includes(dia.getDay()); // más venta viernes y sábado
        const kg = Math.max(0, media * (finde ? 1.5 : 0.85) * (0.6 + rnd() * 0.8));
        const tickets = 1 + Math.floor(rnd() * 3);
        for (let t = 0; t < tickets; t++) {
          const cantidad = Math.max(0.2, Math.round((kg / tickets) * 10) / 10);
          dia.setHours(9 + Math.floor(rnd() * 9), Math.floor(rnd() * 60), 0, 0);
          if (dia > new Date()) dia.setTime(Date.now() - Math.floor(rnd() * 3 * 3600000)); // sin ventas «del futuro»
          await client.query(
            'INSERT INTO ventas (id_producto, id_usuario, fecha_hora, cantidad, precio_unitario_clp, total_clp) VALUES ($1, $2, $3, $4, $5, $6)',
            [id, usuario.id_usuario, dia, cantidad, precio, Math.round(cantidad * precio)]
          );
          ventas++;
        }
        if (d % 4 === 0) {
          const cant = Math.round(media * 4.5 * 10) / 10;
          const costo = Math.round(precio * 0.72);
          dia.setHours(8, 30, 0, 0);
          await client.query(
            `INSERT INTO compras (id_producto, id_proveedor, id_usuario, fecha_hora, cantidad, costo_unitario_clp, costo_total_clp)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, idProv[iProv], usuario.id_usuario, dia, cant, costo, Math.round(cant * costo)]
          );
          compras++;
        }
      }
    }
    await client.query('COMMIT');
    console.log(`Listo: ${PROVEEDORES.length} proveedores, ${PRODUCTOS.length} productos, ${ventas} ventas y ${compras} compras de ejemplo.`);
    console.log('El stock de cada producto quedó en el valor inicial indicado (no se recalcula con el historial de ejemplo).');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch((e) => {
  console.error(`No se pudieron cargar los datos de ejemplo: ${e.message}`);
  process.exit(1);
});
