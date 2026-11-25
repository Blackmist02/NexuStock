/**
 * Carga de ventas, compras y mermas desde CSV (plantillas de Configuración). Pensada para avanzar semana a semana:
 *  - Solo se importan las filas posteriores al último movimiento ya registrado de cada tipo (subir de nuevo el mismo
 *    archivo no duplica nada) y hasta la fecha límite elegida (por defecto, la última del archivo).
 *  - Las filas se aplican en orden cronológico, mezclando los tres tipos (a la misma hora: compra, venta, merma), y el
 *    stock no puede quedar negativo en ningún momento (salvo un faltante de pesaje de hasta TOLERANCIA_KG).
 *  - Todo o nada: si una fila tiene errores no se importa ninguna. La validación previa no escribe en la base.
 */
const config = require('../config');
const db = require('../db');
const { addDays, diffDays, hoy } = require('../lib/dates');
const { leerCsv, leerFecha, leerHora, leerNumero } = require('../lib/csvLeer');
const { withTransaction } = require('../lib/tx');

const MAX_FILAS = 100000;
const MAX_ERRORES = 50;
// Faltante tolerado por redondeo del pesaje (kg): la venta o merma se registra y el faltante queda pendiente (el saldo
// sigue exacto, como en cargar_bd.py) hasta que lo cubre la compra siguiente. Solo si el stock final queda negativo se
// deja en 0, porque la base no admite stock negativo.
const TOLERANCIA_KG = 0.5;
// El local vende todos los días salvo feriados irrenunciables (a lo más 2 seguidos): desde 3 días sin ventas entre lo
// ya cargado y el primer día del archivo, faltan movimientos (p. ej. se deshizo desde antes de lo que trae el archivo).
const DIAS_HUECO = 3;
const fmtDia = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Días sin ventas entre el último día cargado y el primero que se importaría. Sin esas ventas (y sus compras) el stock
 * no cuadra: es la causa típica de los errores de «stock insuficiente» al cargar un tramo suelto.
 */
function huecoDeVentas(ultimo, resumenVentas) {
  if (!ultimo || !resumenVentas || !resumenVentas.desde) return null;
  const desde = addDays(ultimo.slice(0, 10), 1);
  const dias = diffDays(resumenVentas.desde, desde);
  if (dias < DIAS_HUECO) return null;
  return { desde, hasta: addDays(resumenVentas.desde, -1), dias, primero: resumenVentas.desde, ultimo: ultimo.slice(0, 10) };
}

/** Columnas aceptadas (encabezado normalizado) y sus nombres alternativos. */
const ALIAS = {
  fecha: ['fecha', 'fecha_recepcion', 'dia'],
  hora: ['hora'],
  fecha_hora: ['fecha_hora'],
  producto: ['producto', 'nombre_producto'],
  id_producto: ['id_producto'],
  cantidad: ['cantidad', 'cantidad_kg', 'kg'],
  precio: ['precio_unitario_clp', 'precio_unitario', 'precio_unitario_venta_clp', 'precio'],
  costo: ['costo_unitario_clp', 'costo_unitario', 'precio_unitario_compra_clp', 'costo'],
  proveedor: ['proveedor', 'nombre_proveedor'],
  motivo: ['motivo']
};

/** Plantilla de cada tipo: columnas, hora por defecto y orden dentro de un mismo instante. */
const TIPOS = {
  compras: { tabla: 'compras', hora: '08:00:00', orden: 0, columnas: ['fecha', 'hora', 'producto', 'cantidad', 'costo_unitario_clp', 'proveedor'] },
  ventas: { tabla: 'ventas', hora: '12:00:00', orden: 1, columnas: ['fecha', 'hora', 'producto', 'cantidad', 'precio_unitario_clp'] },
  mermas: { tabla: 'mermas', hora: '20:00:00', orden: 2, columnas: ['fecha', 'hora', 'producto', 'cantidad', 'motivo', 'costo_unitario_clp'] }
};
const MOTIVOS = new Set(['vencimiento', 'deterioro', 'otro']);

const clave = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const r2 = (n) => Math.round(n * 100) / 100;

function columnaDe(columnas, campo) {
  return ALIAS[campo].find((a) => columnas.includes(a)) || null;
}

/**
 * Desde cuándo se importa cada tipo («AAAA-MM-DD HH:MM:SS» local): su último movimiento registrado. En una base cargada
 * antes del modelo v5 no hay mermas registradas, pero el stock ya las descuenta: migracion_v5.sql guarda en
 * CONFIGURACION (mermas_incluidas_hasta) el último día cargado, y las mermas se importan solo desde el día siguiente.
 */
async function ultimosRegistrados(client) {
  const out = {};
  for (const [tipo, t] of Object.entries(TIPOS)) {
    const { rows } = await client.query(
      `SELECT to_char(MAX(fecha_hora AT TIME ZONE $1), 'YYYY-MM-DD HH24:MI:SS') AS ultimo FROM ${t.tabla}`,
      [config.tz]
    );
    out[tipo] = rows[0].ultimo;
  }
  if (!out.mermas) {
    const { rows } = await client.query("SELECT valor->>'fecha' AS fecha FROM configuracion WHERE clave = 'mermas_incluidas_hasta'");
    if (rows[0] && rows[0].fecha) out.mermas = `${rows[0].fecha} 23:59:59`;
  }
  return out;
}

/** Lee y valida un archivo. Devuelve las filas válidas y agrega los errores encontrados. */
function leerArchivo(tipo, texto, catalogo, errores, lineasOmitidas = 0) {
  const { columnas, filas } = leerCsv(texto, lineasOmitidas);
  const col = Object.fromEntries(Object.keys(ALIAS).map((c) => [c, columnaDe(columnas, c)]));
  const error = (linea, mensaje) => {
    errores.total++;
    if (errores.lista.length < MAX_ERRORES) errores.lista.push({ tipo, linea, mensaje });
  };
  const faltan = [];
  if (!col.fecha && !col.fecha_hora) faltan.push('fecha');
  if (!col.producto && !col.id_producto) faltan.push('producto');
  if (!col.cantidad) faltan.push('cantidad');
  if (tipo === 'compras' && !col.costo) faltan.push('costo_unitario_clp');
  if (faltan.length) {
    error(1, `Faltan columnas: ${faltan.join(', ')}. Usa la plantilla de ${tipo}.`);
    return { filas: [], leidas: filas.length };
  }
  if (filas.length > MAX_FILAS) {
    error(1, `El archivo tiene ${filas.length} filas; el máximo es ${MAX_FILAS}.`);
    return { filas: [], leidas: filas.length };
  }

  const salida = [];
  for (const { linea, valores: v } of filas) {
    let fecha;
    let hora;
    if (col.fecha_hora && v[col.fecha_hora]) {
      const [f, h] = v[col.fecha_hora].split(/[ T]/);
      fecha = leerFecha(f);
      hora = h ? leerHora(h.slice(0, 8)) : TIPOS[tipo].hora;
    } else {
      fecha = leerFecha(v[col.fecha]);
      hora = col.hora && v[col.hora] ? leerHora(v[col.hora]) : TIPOS[tipo].hora;
    }
    if (!fecha) { error(linea, 'Fecha inválida (usa AAAA-MM-DD o DD/MM/AAAA)'); continue; }
    if (!hora) { error(linea, 'Hora inválida (usa HH:MM)'); continue; }

    const p = col.id_producto && v[col.id_producto] ? catalogo.porId.get(Number(v[col.id_producto])) : catalogo.porNombre.get(clave(v[col.producto]));
    if (!p) { error(linea, `Producto no encontrado: «${v[col.producto] ?? v[col.id_producto]}»`); continue; }
    if (!p.activo) { error(linea, `El producto «${p.nombre}» está inactivo`); continue; }

    const cantidad = leerNumero(v[col.cantidad]);
    if (cantidad == null || r2(cantidad) <= 0) { error(linea, 'La cantidad debe ser un número mayor que 0'); continue; }
    if (p.unidad === 'un' && !Number.isInteger(r2(cantidad))) { error(linea, `«${p.nombre}» se vende por unidad: la cantidad debe ser entera`); continue; }

    const fila = { tipo, linea, fecha, fechaHora: `${fecha} ${hora}`, producto: p, cantidad: r2(cantidad) };
    if (tipo === 'ventas') {
      const precio = col.precio && v[col.precio] !== '' ? leerNumero(v[col.precio]) : p.precio_venta_clp;
      if (precio == null || precio < 0) { error(linea, 'Precio unitario inválido'); continue; }
      fila.unitario = Math.round(precio);
    } else if (tipo === 'compras') {
      const costo = leerNumero(v[col.costo]);
      if (costo == null || costo < 0) { error(linea, 'Costo unitario inválido'); continue; }
      fila.unitario = Math.round(costo);
      const nombreProv = col.proveedor ? v[col.proveedor] : '';
      const prov = nombreProv ? catalogo.proveedores.get(clave(nombreProv)) : catalogo.proveedorPorId.get(p.id_proveedor);
      if (!prov) { error(linea, `Proveedor no encontrado: «${nombreProv}»`); continue; }
      fila.id_proveedor = prov.id_proveedor;
    } else {
      const motivo = col.motivo && v[col.motivo] ? clave(v[col.motivo]) : 'vencimiento';
      if (!MOTIVOS.has(motivo)) { error(linea, 'Motivo inválido (vencimiento, deterioro u otro)'); continue; }
      fila.motivo = motivo;
      const costo = col.costo && v[col.costo] !== '' ? leerNumero(v[col.costo]) : null;
      if (costo != null && costo < 0) { error(linea, 'Costo unitario inválido'); continue; }
      fila.unitario = costo == null ? null : Math.round(costo);
    }
    salida.push(fila);
  }
  return { filas: salida, leidas: filas.length };
}

/**
 * Valida los archivos contra la base (con `client`, dentro o fuera de una transacción) sin escribir nada.
 * `archivos` = { ventas?, compras?, mermas? } con el texto de cada CSV. Devuelve el resumen y las filas a importar.
 */
async function preparar(client, { archivos, recorte = {}, hasta: hastaPedido, avanzar = false }, bloquear = false) {
  const errores = { total: 0, lista: [] };
  const generales = [];
  const prods = (
    await client.query(
      `SELECT id_producto, nombre, unidad, activo, id_proveedor, precio_venta_clp, stock_actual::float AS stock_actual
         FROM productos${bloquear ? ' FOR UPDATE' : ''}`
    )
  ).rows;
  const provs = (await client.query('SELECT id_proveedor, nombre FROM proveedores')).rows;
  const catalogo = {
    porNombre: new Map(prods.map((p) => [clave(p.nombre), p])),
    porId: new Map(prods.map((p) => [Number(p.id_producto), p])),
    proveedores: new Map(provs.map((p) => [clave(p.nombre), p])),
    proveedorPorId: new Map(provs.map((p) => [p.id_proveedor, p]))
  };
  const ultimos = await ultimosRegistrados(client);

  const leidas = {};
  let todas = [];
  for (const tipo of Object.keys(TIPOS)) {
    if (!archivos[tipo]) continue;
    const r = leerArchivo(tipo, archivos[tipo], catalogo, errores, (recorte[tipo] && recorte[tipo].lineas_omitidas) || 0);
    leidas[tipo] = r.leidas;
    todas = todas.concat(r.filas);
  }
  if (!Object.keys(leidas).length) generales.push('Elige al menos un archivo (ventas, compras o mermas).');

  const fechaMax = todas.reduce((m, f) => (f.fecha > m ? f.fecha : m), '');
  const hasta = hastaPedido || fechaMax || null;
  const hoyIso = hoy();
  const real = hoy(new Date());

  const resumen = {};
  const aImportar = [];
  for (const tipo of Object.keys(leidas)) {
    const delTipo = todas.filter((f) => f.tipo === tipo);
    const nuevas = delTipo.filter((f) => !ultimos[tipo] || f.fechaHora > ultimos[tipo]);
    const enRango = nuevas.filter((f) => !hasta || f.fecha <= hasta);
    aImportar.push(...enRango);
    const omit = recorte[tipo] || { ya_cargadas: 0, posteriores: 0 };
    resumen[tipo] = {
      filas: leidas[tipo] + omit.ya_cargadas + omit.posteriores,
      validas: delTipo.length + omit.ya_cargadas + omit.posteriores,
      ya_cargadas: delTipo.length - nuevas.length + omit.ya_cargadas,
      posteriores: nuevas.length - enRango.length + omit.posteriores,
      a_importar: enRango.length,
      desde: enRango.length ? enRango.reduce((m, f) => (f.fecha < m ? f.fecha : m), '9999') : null,
      hasta: enRango.length ? enRango.reduce((m, f) => (f.fecha > m ? f.fecha : m), '') : null,
      cantidad: r2(enRango.reduce((a, f) => a + f.cantidad, 0)),
      monto_clp: enRango.reduce((a, f) => a + (f.unitario == null ? 0 : Math.round(f.cantidad * f.unitario)), 0),
      ultimo_registrado: ultimos[tipo]
    };
  }

  // Fechas: no se cargan movimientos posteriores a «hoy», salvo que la carga avance la fecha del sistema
  const nuevaFecha = avanzar && hasta ? addDays(hasta, 1) : null;
  const tarde = nuevaFecha ? [] : aImportar.filter((f) => f.fecha > hoyIso);
  if (nuevaFecha && nuevaFecha > real) generales.push(`La fecha del sistema quedaría en el ${nuevaFecha}, posterior a hoy (${real}). Elige una fecha límite anterior.`);
  if (tarde.length) {
    generales.push(`Hay ${tarde.length} filas posteriores a la fecha del sistema (${hoyIso}). Marca «Mover la fecha del sistema» o elige una fecha límite anterior.`);
  }

  // Stock en orden cronológico: no puede quedar negativo
  aImportar.sort((a, b) => a.fechaHora.localeCompare(b.fechaHora) || TIPOS[a.tipo].orden - TIPOS[b.tipo].orden || a.linea - b.linea);
  const stock = new Map(prods.map((p) => [p.id_producto, p.stock_actual]));
  const ajustes = { total: 0, kg: 0, lista: [] };
  for (const f of aImportar) {
    const id = f.producto.id_producto;
    const nuevo = r2(stock.get(id) + (f.tipo === 'compras' ? f.cantidad : -f.cantidad));
    if (nuevo < 0 && f.producto.unidad === 'kg' && -nuevo <= TOLERANCIA_KG) {
      ajustes.total++;
      if (ajustes.lista.length < MAX_ERRORES) {
        ajustes.lista.push({ tipo: f.tipo, linea: f.linea, mensaje: `«${f.producto.nombre}» el ${f.fechaHora.slice(0, 16)}: faltan ${-nuevo} kg por el pesaje; los cubre la compra siguiente` });
      }
      stock.set(id, nuevo);
      continue;
    }
    if (nuevo < 0) {
      errores.total++;
      if (errores.lista.length < MAX_ERRORES) {
        errores.lista.push({
          tipo: f.tipo,
          linea: f.linea,
          mensaje: `Stock insuficiente de «${f.producto.nombre}» el ${f.fechaHora.slice(0, 16)}: hay ${stock.get(id)} y se ${f.tipo === 'ventas' ? 'venden' : 'dan de baja'} ${f.cantidad}`
        });
      }
      continue;
    }
    stock.set(id, nuevo);
  }
  // Faltante que ninguna compra alcanzó a cubrir: el stock queda en 0
  for (const p of prods) {
    const final = stock.get(p.id_producto);
    if (final < 0) {
      ajustes.kg = r2(ajustes.kg - final);
      ajustes.lista.push({ tipo: 'stock', linea: 0, mensaje: `«${p.nombre}» termina con ${final} kg; queda en 0` });
      stock.set(p.id_producto, 0);
    }
  }
  // Aviso claro cuando faltan días entre lo cargado y el archivo (no bloquea por sí solo: un local pudo cerrar)
  const avisos = [];
  const hueco = huecoDeVentas(ultimos.ventas, resumen.ventas);
  if (hueco) {
    avisos.push(
      `Faltan movimientos: lo cargado llega al ${fmtDia(hueco.ultimo)} y las ventas del archivo empiezan el ${fmtDia(hueco.primero)}, ` +
        `así que no hay datos del ${fmtDia(hueco.desde)} al ${fmtDia(hueco.hasta)} (${hueco.dias} días).` +
        (errores.total ? ' Sin esas compras y ventas el stock no cuadra: por eso aparecen los errores de «stock insuficiente».' : '') +
        ` Sube archivos que cubran desde el ${fmtDia(hueco.desde)} (por ejemplo, las plantillas del año completo): lo ya cargado no se duplica.`
    );
  }
  const cambios = prods
    .filter((p) => r2(stock.get(p.id_producto)) !== r2(p.stock_actual))
    .map((p) => ({ id_producto: p.id_producto, producto: p.nombre, unidad: p.unidad, antes: r2(p.stock_actual), despues: r2(stock.get(p.id_producto)) }));

  return {
    valido: !generales.length && !errores.total && aImportar.length > 0,
    hasta,
    fecha_sistema: { actual: hoyIso, nueva: nuevaFecha },
    tipos: resumen,
    total_a_importar: aImportar.length,
    hueco,
    avisos,
    errores_generales:
      aImportar.length || generales.length || errores.total
        ? generales
        : ['No hay filas nuevas para importar: todo lo del archivo ya está cargado o es posterior a la fecha límite.'],
    errores: errores.lista,
    total_errores: errores.total,
    advertencias: ajustes.lista,
    total_advertencias: ajustes.total,
    kg_ajustados: ajustes.kg,
    stock: cambios,
    _filas: aImportar,
    _stock: stock
  };
}

const publico = ({ _filas, _stock, ...r }) => r;

/** Revisa los archivos sin escribir nada. */
async function validar(params) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    return publico(await preparar(client, params));
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

/** Importa en una transacción. Si algo no es válido no escribe nada y devuelve el resumen con los errores. */
async function importar(params, idUsuario) {
  return withTransaction(async (client) => {
    const r = await preparar(client, params, true);
    if (!r.valido) return { ...publico(r), importado: false };
    const por = (tipo) => r._filas.filter((f) => f.tipo === tipo);
    const ventas = por('ventas');
    const compras = por('compras');
    const mermas = por('mermas');
    if (ventas.length) {
      await client.query(
        `INSERT INTO ventas (id_producto, id_usuario, fecha_hora, cantidad, precio_unitario_clp, total_clp)
         SELECT x.p, $1, (x.f::timestamp AT TIME ZONE $2), x.c, x.u, x.t
           FROM unnest($3::bigint[], $4::text[], $5::numeric[], $6::int[], $7::int[]) AS x(p, f, c, u, t)`,
        [idUsuario, config.tz, ventas.map((f) => f.producto.id_producto), ventas.map((f) => f.fechaHora), ventas.map((f) => f.cantidad),
          ventas.map((f) => f.unitario), ventas.map((f) => Math.round(f.cantidad * f.unitario))]
      );
    }
    if (compras.length) {
      await client.query(
        `INSERT INTO compras (id_producto, id_proveedor, id_usuario, fecha_hora, cantidad, costo_unitario_clp, costo_total_clp)
         SELECT x.p, x.pr, $1, (x.f::timestamp AT TIME ZONE $2), x.c, x.u, x.t
           FROM unnest($3::bigint[], $4::bigint[], $5::text[], $6::numeric[], $7::int[], $8::int[]) AS x(p, pr, f, c, u, t)`,
        [idUsuario, config.tz, compras.map((f) => f.producto.id_producto), compras.map((f) => f.id_proveedor), compras.map((f) => f.fechaHora),
          compras.map((f) => f.cantidad), compras.map((f) => f.unitario), compras.map((f) => Math.round(f.cantidad * f.unitario))]
      );
    }
    if (mermas.length) {
      await client.query(
        `INSERT INTO mermas (id_producto, id_usuario, fecha_hora, cantidad, motivo, costo_unitario_clp, costo_total_clp)
         SELECT x.p, $1, (x.f::timestamp AT TIME ZONE $2), x.c, x.m, x.u, x.t
           FROM unnest($3::bigint[], $4::text[], $5::numeric[], $6::text[], $7::int[], $8::int[]) AS x(p, f, c, m, u, t)`,
        [idUsuario, config.tz, mermas.map((f) => f.producto.id_producto), mermas.map((f) => f.fechaHora), mermas.map((f) => f.cantidad),
          mermas.map((f) => f.motivo), mermas.map((f) => f.unitario), mermas.map((f) => (f.unitario == null ? null : Math.round(f.cantidad * f.unitario)))]
      );
    }
    if (r.stock.length) {
      await client.query(
        `UPDATE productos p SET stock_actual = x.s FROM unnest($1::bigint[], $2::numeric[]) AS x(id, s) WHERE p.id_producto = x.id`,
        [r.stock.map((c) => c.id_producto), r.stock.map((c) => c.despues)]
      );
    }
    return { ...publico(r), importado: true };
  });
}

/**
 * Deshacer movimientos (para volver a mostrar una carga en una demostración): ventas, compras y mermas desde el día
 * `desde` (incluido, hora local) en adelante. El stock vuelve a como estaba al inicio de ese día (se suman las ventas y
 * mermas quitadas y se restan las compras), y se borran las alertas creadas desde ese día (las cerradas desde entonces
 * vuelven a quedar activas). Solo con fecha de referencia: con la fecha real se perderían movimientos verdaderos.
 */
async function prepararDeshacer(client, desde, bloquear = false) {
  const generales = [];
  if (bloquear) await client.query('SELECT 1 FROM productos FOR UPDATE'); // como la importación: nadie mueve stock mientras tanto
  // Marca de migracion_v5.sql (mermas descontadas del stock sin registrarse hasta ese día). Si hay mermas registradas
  // hasta ese día, la base se recargó con ellas (cargar_bd.py --reemplazar) y la marca quedó obsoleta.
  const { rows: cfg } = await client.query(
    `SELECT valor->>'fecha' AS fecha FROM configuracion c
      WHERE clave = 'mermas_incluidas_hasta'
        AND NOT EXISTS (SELECT 1 FROM mermas WHERE fecha_hora < (((c.valor->>'fecha')::date + 1)::timestamp AT TIME ZONE $1))`,
    [config.tz]
  );
  const mermasHasta = cfg[0] && cfg[0].fecha;
  if (mermasHasta && desde <= mermasHasta) {
    generales.push(`Hasta el ${mermasHasta} las mermas están incluidas en el stock sin registrarse: elige una fecha posterior.`);
  }
  if (desde > hoy()) generales.push(`La fecha (${desde}) es posterior a la fecha del sistema (${hoy()}).`);

  const inicio = '($1::date::timestamp AT TIME ZONE $2)';
  const tipos = {};
  for (const [tipo, t] of Object.entries(TIPOS)) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS movimientos, COALESCE(SUM(cantidad), 0)::float AS cantidad,
              to_char(MIN(fecha_hora AT TIME ZONE $2), 'YYYY-MM-DD') AS desde, to_char(MAX(fecha_hora AT TIME ZONE $2), 'YYYY-MM-DD') AS hasta
         FROM ${t.tabla} WHERE fecha_hora >= ${inicio}`,
      [desde, config.tz]
    );
    tipos[tipo] = { ...rows[0], cantidad: r2(rows[0].cantidad) };
  }
  const { rows: prods } = await client.query(
    `WITH d AS (
       SELECT id_producto, cantidad AS delta FROM ventas WHERE fecha_hora >= ${inicio}
       UNION ALL SELECT id_producto, cantidad FROM mermas WHERE fecha_hora >= ${inicio}
       UNION ALL SELECT id_producto, -cantidad FROM compras WHERE fecha_hora >= ${inicio})
     SELECT p.id_producto, p.nombre, p.unidad, p.stock_actual::float AS stock_actual, SUM(d.delta)::float AS delta
       FROM d JOIN productos p USING (id_producto)
      GROUP BY p.id_producto`,
    [desde, config.tz]
  );
  // El stock no puede quedar negativo (un faltante por redondeo del pesaje pudo dejarlo en 0 al importar)
  const stock = prods
    .map((p) => ({ id_producto: p.id_producto, producto: p.nombre, unidad: p.unidad, antes: r2(p.stock_actual), exacto: r2(p.stock_actual + p.delta) }))
    .map(({ exacto, ...s }) => ({ ...s, despues: Math.max(0, exacto), faltante: exacto < 0 ? -exacto : 0 }))
    .filter((s) => s.antes !== s.despues || s.faltante)
    .sort((a, b) => a.producto.localeCompare(b.producto));
  // Saldo negativo al inicio del día (faltantes de pesaje sin cubrir): queda en 0 y al volver a cargar no cuadra exacto
  const advertencias = stock
    .filter((s) => s.faltante)
    .map((s) => `«${s.producto}» tenía ${-s.faltante} ${s.unidad} al inicio del ${desde} (faltante de pesaje): queda en 0, y al volver a cargar terminará con ${s.faltante} ${s.unidad} de más.`);
  const { rows: al } = await client.query(
    `SELECT COUNT(*) FILTER (WHERE creada_en >= ${inicio})::int AS borradas,
            COUNT(*) FILTER (WHERE creada_en < ${inicio} AND resuelta_en >= ${inicio})::int AS reabiertas
       FROM alertas_inventario`,
    [desde, config.tz]
  );
  const total = Object.values(tipos).reduce((a, t) => a + t.movimientos, 0);
  if (!total && !generales.length) generales.push(`No hay ventas, compras ni mermas desde el ${desde}.`);
  return {
    valido: !generales.length,
    desde,
    fecha_sistema: { actual: hoy(), nueva: desde },
    tipos,
    total,
    alertas: al[0],
    stock,
    advertencias,
    errores_generales: generales
  };
}

/** Revisa qué se desharía desde `desde`, sin escribir nada. */
async function revisarDeshacer(desde) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    return await prepararDeshacer(client, desde);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

/** Deshace en una transacción (todo o nada). La fecha del sistema y las alertas se recalculan después (en la ruta). */
async function deshacer(desde) {
  return withTransaction(async (client) => {
    const r = await prepararDeshacer(client, desde, true);
    if (!r.valido) return { ...r, deshecho: false };
    const p = [desde, config.tz];
    const inicio = '($1::date::timestamp AT TIME ZONE $2)';
    for (const t of Object.values(TIPOS)) await client.query(`DELETE FROM ${t.tabla} WHERE fecha_hora >= ${inicio}`, p);
    if (r.stock.length) {
      await client.query(
        `UPDATE productos p SET stock_actual = x.s FROM unnest($1::bigint[], $2::numeric[]) AS x(id, s) WHERE p.id_producto = x.id`,
        [r.stock.map((s) => s.id_producto), r.stock.map((s) => s.despues)]
      );
    }
    await client.query(`DELETE FROM alertas_inventario WHERE creada_en >= ${inicio}`, p);
    await client.query(`UPDATE alertas_inventario SET estado = 'activa', resuelta_en = NULL WHERE resuelta_en >= ${inicio}`, p);
    return { ...r, deshecho: true };
  });
}

/** Plantilla CSV (separador «;», como la exporta Excel en español) con dos filas de ejemplo. */
async function plantilla(tipo) {
  const t = TIPOS[tipo];
  const { rows } = await db.query(
    `SELECT p.nombre, p.precio_venta_clp, pr.nombre AS proveedor
       FROM productos p JOIN proveedores pr ON pr.id_proveedor = p.id_proveedor
      WHERE p.activo ORDER BY p.nombre LIMIT 2`
  );
  const ej = rows.length ? rows : [{ nombre: 'Lomo Vetado', precio_venta_clp: 13990, proveedor: 'Proveedor habitual' }];
  const f = hoy();
  const filas = ej.map((p, i) => {
    if (tipo === 'ventas') return [f, `1${i}:30`, p.nombre, i ? '0,8' : '1,25', p.precio_venta_clp];
    if (tipo === 'compras') return [f, '08:00', p.nombre, i ? '12' : '20,5', Math.round(p.precio_venta_clp * 0.7), p.proveedor];
    return [f, '20:00', p.nombre, i ? '0,6' : '1,1', i ? 'deterioro' : 'vencimiento', Math.round(p.precio_venta_clp * 0.7)];
  });
  const celda = (v) => (/[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return `\uFEFF${[t.columnas, ...filas].map((l) => l.map(celda).join(';')).join('\r\n')}\r\n`;
}

module.exports = { validar, importar, plantilla, revisarDeshacer, deshacer, TIPOS };
