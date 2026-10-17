// Pruebas de integración de la API contra PostgreSQL.
//
// Requieren una base de datos DESCARTABLE: define TEST_DATABASE_URL (el nombre de la base debe terminar en «_test»).
// Antes de correr se borra todo el esquema `public` de esa base y se vuelve a crear con ../init.sql.
//   Ejemplo: TEST_DATABASE_URL=postgres://nexustock:nexustock_dev@localhost:5433/nexustock_test npm test
// Sin TEST_DATABASE_URL estas pruebas se omiten.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, test } = require('node:test');

const URL_BD = process.env.TEST_DATABASE_URL;
const omitir = !URL_BD || !/_test(\?.*)?$/.test(URL_BD) ? 'Define TEST_DATABASE_URL (la base debe terminar en _test) para correr las pruebas de la API' : false;

describe('API de NexuStock', { skip: omitir }, () => {
  let server, base, db;
  const sesiones = {};

  async function llamar(quien, metodo, ruta, cuerpo) {
    const headers = { 'x-nx-csrf': '1' };
    if (cuerpo !== undefined) headers['content-type'] = 'application/json';
    if (quien && sesiones[quien]) headers.cookie = sesiones[quien];
    const res = await fetch(`${base}/api${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    const texto = Buffer.from(await res.arrayBuffer()).toString('utf8'); // conserva el BOM de los CSV
    let json;
    try { json = texto ? JSON.parse(texto) : undefined; } catch { json = undefined; }
    return { status: res.status, json, texto, headers: res.headers };
  }

  const ok = (r, status) => assert.equal(r.status, status, r.texto.slice(0, 300));

  async function entrar(quien, email, password) {
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nx-csrf': '1' }, body: JSON.stringify({ email, password }) });
    assert.equal(res.status, 200, `login de ${quien}`);
    sesiones[quien] = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  }

  before(async () => {
    process.env.DATABASE_URL = URL_BD;
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-test-'));
    process.env.COOKIE_SECURE = 'false';
    process.env.ALLOW_PUBLIC_SIGNUP = 'false';
    process.env.EVALUACION_CADA_MIN = '0';
    process.env.ML_ENGINE_DIR = path.join(process.env.DATA_DIR, 'ml-engine'); // sin motor: se usa el respaldo
    process.env.AUTH_RATE_LIMIT = '1000';
    db = require('../src/db');
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await db.query(fs.readFileSync(path.join(__dirname, '../../init.sql'), 'utf8'));
    await require('../src/services/eventos').sembrarSiVacio(); // lo que el servidor hace al arrancar
    const app = require('../src/app');
    await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((ok) => server.close(ok));
    if (db) await db.pool.end();
  });

  const ids = {};

  test('la primera cuenta es administrador y exige negocio y términos; el registro se cierra después', async () => {
    const sin = await llamar(null, 'POST', '/auth/register', { nombre: 'Ana Pérez', email: 'ana@carniceria.cl', password: 'Clave1234' });
    assert.equal(sin.status, 400);
    assert.equal(sin.json.error.code, 'validacion');
    assert.ok(sin.json.error.details.some((d) => d.campo === 'negocio'));

    const ok = await llamar(null, 'POST', '/auth/register', { nombre: 'Ana Pérez', email: 'ana@carniceria.cl', password: 'Clave1234', negocio: 'Carnicería Don Lomo', acepta_terminos: true });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.user.rol, 'administrador');

    const otra = await llamar(null, 'POST', '/auth/register', { nombre: 'Otra', email: 'otra@carniceria.cl', password: 'Clave1234', negocio: 'Otro negocio', acepta_terminos: true });
    assert.equal(otra.status, 403);

    await entrar('admin', 'ana@carniceria.cl', 'Clave1234');
    const cfg = await llamar('admin', 'GET', '/config');
    assert.equal(cfg.json.data.negocio.nombre, 'Carnicería Don Lomo');
  });

  test('sin sesión no se accede a los datos', async () => {
    assert.equal((await llamar(null, 'GET', '/products')).status, 401);
    assert.equal((await llamar(null, 'GET', '/dashboard')).status, 401);
    assert.equal((await llamar(null, 'POST', '/auth/login', { email: 'ana@carniceria.cl', password: 'incorrecta' })).status, 401);
  });

  test('alta de equipo con roles (RF-12) y permisos por rol', async () => {
    for (const [nombre, email, rol] of [['Turno Tarde', 'turno@carniceria.cl', 'operador'], ['Manuel TI', 'ti@carniceria.cl', 'ti']]) {
      const r = await llamar('admin', 'POST', '/users', { nombre, email, password: 'Clave1234', rol });
      assert.equal(r.status, 201);
    }
    const dup = await llamar('admin', 'POST', '/users', { nombre: 'Turno', email: 'turno@carniceria.cl', password: 'Clave1234', rol: 'operador' });
    assert.equal(dup.status, 400);
    assert.equal(dup.json.error.details[0].campo, 'email');
    await entrar('operador', 'turno@carniceria.cl', 'Clave1234');
    await entrar('ti', 'ti@carniceria.cl', 'Clave1234');
    assert.equal((await llamar('operador', 'GET', '/users')).status, 403);
    assert.equal((await llamar('operador', 'POST', '/categories', { nombre: 'Ovino' })).status, 403);
    assert.equal((await llamar('operador', 'GET', '/models')).status, 403);
  });

  test('catálogo: categorías, proveedores y productos con validación por campo', async () => {
    // el esquema trae categorías iniciales (Vacuno, Cerdo, Pollo, Embutidos)
    const iniciales = await llamar('admin', 'GET', '/categories');
    ids.cat = iniciales.json.data.find((c) => c.nombre === 'Vacuno').id_categoria;
    const cat = await llamar('admin', 'POST', '/categories', { nombre: 'Achuras' });
    ok(cat, 201);
    assert.equal((await llamar('admin', 'POST', '/categories', { nombre: 'Achuras' })).status, 400, 'categoría duplicada');
    assert.equal((await llamar('operador', 'DELETE', `/categories/${cat.json.data.id_categoria}`)).status, 403);
    ok(await llamar('admin', 'DELETE', `/categories/${cat.json.data.id_categoria}`), 204);

    const malProv = await llamar('admin', 'POST', '/suppliers', { nombre: 'Agro', lead_time_dias: -1, dias_habiles: [] });
    assert.equal(malProv.status, 400);
    const prov = await llamar('ti', 'POST', '/suppliers', { nombre: 'Agrocarnes', contacto: null, lead_time_dias: 2, dias_habiles: [1, 2, 3, 4, 5] });
    ok(prov, 201);
    ids.prov = prov.json.data.id_proveedor;

    const malo = await llamar('admin', 'POST', '/products', { nombre: 'L', id_categoria: ids.cat, id_proveedor: ids.prov, unidad: 'kg', precio_venta_clp: -5 });
    assert.equal(malo.status, 400);
    assert.ok(malo.json.error.details.some((d) => d.campo === 'nombre'));
    assert.ok(malo.json.error.details.some((d) => d.campo === 'precio_venta_clp'));

    const prod = await llamar('admin', 'POST', '/products', {
      nombre: 'Lomo vetado', id_categoria: ids.cat, id_proveedor: ids.prov, unidad: 'kg', precio_venta_clp: 10000, stock_minimo: 5, stock_inicial: 20, vida_util_dias: 5
    });
    ok(prod, 201);
    ids.lomo = prod.json.data.id_producto;
    assert.equal(prod.json.data.stock_actual, 20);
    const un = await llamar('admin', 'POST', '/products', { nombre: 'Bandeja de hamburguesas', id_categoria: ids.cat, id_proveedor: ids.prov, unidad: 'un', precio_venta_clp: 3500, stock_minimo: 2, stock_inicial: 10 });
    ok(un, 201);
    ids.hamb = un.json.data.id_producto;
    assert.equal((await llamar('admin', 'POST', '/products', { nombre: 'lomo vetado', id_categoria: ids.cat, id_proveedor: ids.prov, unidad: 'kg', precio_venta_clp: 1 })).status, 400, 'nombre duplicado');
  });

  test('venta (RF-01): descuenta stock en una transacción y valida cantidad', async () => {
    const base = { id_producto: ids.lomo };
    const cero = await llamar('operador', 'POST', '/sales', { ...base, cantidad: 0 });
    assert.equal(cero.status, 400);
    assert.equal(cero.json.error.details[0].campo, 'cantidad');
    const exceso = await llamar('operador', 'POST', '/sales', { ...base, cantidad: 50 });
    assert.equal(exceso.status, 409);
    assert.equal(exceso.json.error.details[0].campo, 'cantidad');
    const decimal = await llamar('operador', 'POST', '/sales', { id_producto: ids.hamb, cantidad: 1.5 });
    assert.equal(decimal.status, 400, 'las unidades son enteras');
    const futura = await llamar('operador', 'POST', '/sales', { ...base, cantidad: 1, fecha_hora: new Date(Date.now() + 86400000).toISOString() });
    assert.equal(futura.status, 400);

    const ok = await llamar('operador', 'POST', '/sales', { ...base, cantidad: 2.5 });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.data.stock_anterior, 20);
    assert.equal(ok.json.data.stock_nuevo, 17.5);
    assert.equal(ok.json.data.total_clp, 25000); // precio del catálogo × cantidad
    const { rows } = await db.query('SELECT stock_actual FROM productos WHERE id_producto = $1', [ids.lomo]);
    assert.equal(rows[0].stock_actual, 17.5);
    assert.equal((await llamar('ti', 'POST', '/sales', { ...base, cantidad: 1 })).status, 403, 'TI no registra ventas');
  });

  test('compra (RF-02): suma stock y registra proveedor', async () => {
    const r = await llamar('operador', 'POST', '/purchases', { id_producto: ids.lomo, cantidad: 10, costo_unitario_clp: 7000 });
    assert.equal(r.status, 201);
    assert.equal(r.json.data.stock_nuevo, 27.5);
    assert.equal(r.json.data.costo_total_clp, 70000);
    assert.equal(r.json.data.id_proveedor, ids.prov);
    const sinCosto = await llamar('operador', 'POST', '/purchases', { id_producto: ids.lomo, cantidad: 1 });
    assert.equal(sinCosto.status, 400);
  });

  test('alertas (RF-05, RF-08/09/10): se generan al bajar el stock, se atienden y se cierran', async () => {
    // Dejar el lomo bajo el mínimo (5 kg): vender casi todo
    const v = await llamar('operador', 'POST', '/sales', { id_producto: ids.lomo, cantidad: 25 });
    assert.equal(v.status, 201);
    assert.equal(v.json.data.nivel, 'quiebre');
    assert.equal(v.json.data.alerta_generada, true);

    const lista = await llamar('admin', 'GET', '/alerts?estado=activa');
    const alerta = lista.json.data.find((a) => a.id_producto === ids.lomo);
    assert.ok(alerta, 'hay una alerta activa para el lomo');
    assert.equal(alerta.nivel, 'quiebre');
    assert.ok(alerta.cantidad_sugerida > 0);

    // Solo el administrador atiende o descarta
    assert.equal((await llamar('operador', 'PATCH', `/alerts/${alerta.id_alerta}`, { estado: 'atendida' })).status, 403);
    const dash = await llamar('admin', 'GET', '/dashboard');
    assert.equal(dash.status, 200);
    assert.ok(dash.json.kpis.productos_quiebre >= 1);
    assert.ok(dash.json.sugerencias.some((s) => s.id_producto === ids.lomo));

    // Al reponer el stock la alerta se cierra sola como «atendida»
    const c = await llamar('operador', 'POST', '/purchases', { id_producto: ids.lomo, cantidad: 40, costo_unitario_clp: 7000 });
    assert.equal(c.status, 201);
    const activas = await llamar('admin', 'GET', '/alerts?estado=activa');
    assert.ok(!activas.json.data.some((a) => a.id_producto === ids.lomo));
    const cerradas = await llamar('admin', 'GET', '/alerts?estado=atendida');
    assert.ok(cerradas.json.data.some((a) => a.id_alerta === alerta.id_alerta));
  });

  test('predicción con respaldo (RF-11): sin modelo activo se usa el promedio histórico', async () => {
    const r = await llamar('admin', 'GET', '/predictions/resumen');
    assert.equal(r.status, 200);
    assert.equal(r.json.motor.estado, 'respaldo');
    assert.ok(r.json.productos.every((p) => p.origen_demanda !== 'modelo'));
    const g = await llamar('admin', 'POST', '/predictions/generar', { id_producto: ids.lomo, horizonte: 'semana' });
    assert.equal(g.status, 201);
    assert.equal(g.json.data.respaldo, true);
    assert.equal((await llamar('operador', 'POST', '/predictions/generar', { id_producto: ids.lomo })).status, 403);
  });

  test('modelos (RF-06): solo TI registra; la ruta debe existir en ml-engine', async () => {
    const cuerpo = {
      algoritmo: 'Random Forest', version: 'v1', mae_general: 3.2, mae_festivos: 5,
      entrenado_desde: '2022-01-01', entrenado_hasta: '2023-12-31', prueba_desde: '2024-01-01', prueba_hasta: '2024-12-31', artefacto_ruta: 'models/no-existe.joblib'
    };
    assert.equal((await llamar('admin', 'POST', '/models', cuerpo)).status, 403);
    const r = await llamar('ti', 'POST', '/models', cuerpo);
    assert.equal(r.status, 400);
    assert.equal(r.json.error.details[0].campo, 'artefacto_ruta');
    assert.equal((await llamar('admin', 'GET', '/models')).status, 200);
  });

  test('historial, exportación CSV y calendario', async () => {
    const h = await llamar('admin', 'GET', '/history');
    assert.equal(h.status, 200);
    assert.ok(h.json.totales.ventas_n >= 2);
    assert.equal(h.json.semanas.length, 6);
    const mal = await llamar('admin', 'GET', '/history?desde=2026-10-10&hasta=2026-10-01');
    assert.equal(mal.status, 400);
    const csv = await llamar('admin', 'GET', '/history/export.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.ok(csv.texto.startsWith('﻿Fecha y hora;Tipo;Producto'));
    const inv = await llamar('admin', 'GET', '/products/export.csv');
    assert.ok(inv.texto.includes('Lomo vetado'));

    const anio = new Date().getUTCFullYear();
    const ev = await llamar('admin', 'GET', `/events?desde=${anio}-01-01&hasta=${anio}-12-31`);
    assert.equal(ev.status, 200);
    assert.ok(ev.json.data.some((e) => e.nombre === 'Fiestas Patrias'));
    const nuevo = await llamar('ti', 'POST', '/events', { fecha: `${anio}-11-20`, nombre: 'Aniversario del barrio', tipo: 'otro' });
    assert.equal(nuevo.status, 201);
    assert.equal((await llamar('operador', 'POST', '/events', { fecha: `${anio}-11-21`, nombre: 'Otro', tipo: 'otro' })).status, 403);
  });

  test('integridad: un producto con historial no se elimina, se desactiva (RNF-10)', async () => {
    const del = await llamar('admin', 'DELETE', `/products/${ids.lomo}`);
    assert.equal(del.status, 409);
    assert.equal(del.json.error.code, 'tiene_historial');
    const baja = await llamar('admin', 'PATCH', `/products/${ids.lomo}/estado`, { activo: false });
    assert.equal(baja.status, 200);
    assert.equal(baja.json.data.activo, false);
    const venta = await llamar('operador', 'POST', '/sales', { id_producto: ids.lomo, cantidad: 1 });
    assert.equal(venta.status, 400, 'un producto inactivo no admite ventas');
    // sin historial sí se puede eliminar
    const nuevo = await llamar('admin', 'POST', '/products', { nombre: 'Prueba', id_categoria: ids.cat, id_proveedor: ids.prov, unidad: 'kg', precio_venta_clp: 100 });
    assert.equal((await llamar('admin', 'DELETE', `/products/${nuevo.json.data.id_producto}`)).status, 204);
    // un proveedor con productos activos no se desactiva
    assert.equal((await llamar('admin', 'PATCH', `/suppliers/${ids.prov}/estado`, { activo: false })).status, 409);
  });

  test('usuarios: no se puede dejar el sistema sin administrador ni cambiar el propio rol', async () => {
    const lista = await llamar('admin', 'GET', '/users');
    const yo = lista.json.data.find((u) => u.email === 'ana@carniceria.cl');
    const r = await llamar('admin', 'PATCH', `/users/${yo.id}`, { activo: false });
    assert.equal(r.status, 409);
    const rol = await llamar('admin', 'PATCH', `/users/${yo.id}`, { rol: 'operador' });
    assert.equal(rol.status, 409);
    // solo TI emite el enlace de restablecimiento (RF-13)
    const op = lista.json.data.find((u) => u.email === 'turno@carniceria.cl');
    assert.equal((await llamar('admin', 'POST', `/users/${op.id}/reset-link`)).status, 403);
    const enlace = await llamar('ti', 'POST', `/users/${op.id}/reset-link`);
    assert.equal(enlace.status, 200);
    assert.match(enlace.json.data.enlace, /^https?:\/\//);
  });

  test('configuración: nombre del negocio y activación de alertas', async () => {
    const r = await llamar('admin', 'PUT', '/config', { nombre: 'Carnicería Don Lomo SpA', alertas: { bajo: false } });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.negocio.nombre, 'Carnicería Don Lomo SpA');
    assert.equal(r.json.data.alertas.bajo, false);
    assert.equal(r.json.data.alertas.quiebre, true);
    assert.equal((await llamar('operador', 'PUT', '/config', { nombre: 'Hackeado' })).status, 403);
  });
});
