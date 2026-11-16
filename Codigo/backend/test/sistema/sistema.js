/**
 * Pruebas de integración y de sistema (tarea #28) contra un entorno desplegado (demo: Vercel + Render + Supabase).
 *
 * Recorre los casos de uso CU-01 a CU-13 del Documento 01 por la API real, mide los tiempos contra las cotas de
 * «Rendimiento» y verifica los controles de seguridad (HTTPS, CORS, CSRF, sesión, mensajes sin detalles técnicos).
 *
 * Uso (desde Codigo/backend):
 *   QA_EMAIL=qa-admin@nexustock.test QA_PASSWORD=... node test/sistema/sistema.js \
 *     [--api https://nexustock-api.onrender.com] [--front https://nexustock-omega.vercel.app] [--salida carpeta]
 *
 * Requisitos: una cuenta de administrador DE PRUEBA (nunca una cuenta real). El script crea sus propios datos con el
 * prefijo «QA-28» (categoría, proveedores, productos, cuentas qa-*@nexustock.test) y solo registra ventas y compras
 * sobre esos productos. Los datos de prueba se eliminan después con el script de limpieza del informe.
 * No forma parte de `npm test` (no termina en .test.js) ni del CI: modifica datos del entorno al que apunta.
 * El límite de intentos de autenticación (20 en 15 minutos por IP) alcanza para una ejecución: espera 15 minutos
 * antes de repetirla.
 */
const fs = require('node:fs');
const path = require('node:path');

const arg = (n, def) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const API = arg('api', process.env.API_URL || 'https://nexustock-api.onrender.com').replace(/\/$/, '');
const FRONT = arg('front', process.env.FRONT_URL || 'https://nexustock-omega.vercel.app').replace(/\/$/, '');
const SALIDA = arg('salida', path.join(__dirname, 'resultados'));
const QA = { email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD };
if (!QA.email || !QA.password) {
  console.error('Define QA_EMAIL y QA_PASSWORD (cuenta de administrador de prueba).');
  process.exit(2);
}
if (!/@nexustock\.test$/.test(QA.email)) {
  console.error('Por seguridad, la cuenta de prueba debe ser del dominio reservado @nexustock.test.');
  process.exit(2);
}

const SUFIJO = Date.now().toString(36).slice(-5);
const PASS_OP = `Operador${SUFIJO}1`;
const PASS_TI = `Soporte${SUFIJO}2`;
const resultados = [];
const tiempos = [];

/* ---------------------------------------------------------------- cliente HTTP con sesión por cookie */
class Sesion {
  constructor(nombre) {
    this.nombre = nombre;
    this.cookie = null;
  }
  async pedir(metodo, ruta, { body, headers = {}, base = API, csrf = true, crudo = false } = {}) {
    const h = { Accept: 'application/json', ...headers };
    if (body !== undefined && typeof body !== 'string') h['Content-Type'] = 'application/json';
    if (typeof body === 'string') h['Content-Type'] = 'application/json';
    if (csrf && !['GET', 'HEAD'].includes(metodo)) h['x-nx-csrf'] = '1';
    if (this.cookie) h.Cookie = `nx_token=${this.cookie}`;
    const t0 = performance.now();
    const res = await fetch(base + ruta, {
      method: metodo,
      headers: h,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual'
    });
    const texto = await res.text();
    const ms = Math.round(performance.now() - t0);
    for (const c of res.headers.getSetCookie?.() || []) {
      const m = c.match(/^nx_token=([^;]*)/);
      if (m) this.cookie = m[1] || null;
    }
    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {
      /* respuesta no JSON */
    }
    return { status: res.status, json, texto: crudo ? texto : undefined, headers: res.headers, ms, setCookie: res.headers.getSetCookie?.() || [] };
  }
  get(r, o) { return this.pedir('GET', r, o); }
  post(r, body, o = {}) { return this.pedir('POST', r, { ...o, body }); }
  put(r, body, o = {}) { return this.pedir('PUT', r, { ...o, body }); }
  patch(r, body, o = {}) { return this.pedir('PATCH', r, { ...o, body }); }
  del(r, o) { return this.pedir('DELETE', r, o); }
  async login(email, password) {
    return this.post('/api/auth/login', { email, password });
  }
}

/* ---------------------------------------------------------------- registro de resultados */
function caso(id, cu, descripcion, esperado, cond, obtenido, extra = {}) {
  const ok = !!cond;
  // Un caso marcado como observación no bloquea la salida: registra una mejora recomendada
  const resultado = ok ? 'Aprobado' : extra.observacion ? 'Observación' : 'Fallido';
  resultados.push({ id, cu, descripcion, esperado, obtenido, resultado, ...extra });
  console.log(`${ok ? '✔' : extra.observacion ? '△' : '✘'} ${id} [${cu}] ${descripcion} — ${obtenido}`);
  return ok;
}
/** Registra una medición contra su cota (ms). */
function tiempo(id, cu, operacion, ms, cotaMs) {
  tiempos.push({ id, cu, operacion, ms, cota_ms: cotaMs, cumple: ms <= cotaMs });
}
const campoDe = (r) => r.json?.error?.details?.[0]?.campo;
const detalleDe = (r) => `«${r.json?.error?.details?.[0]?.mensaje || r.json?.error?.message || ''}»`;
const resumen = (r) => `HTTP ${r.status}${r.json?.error ? ` ${r.json.error.code}` : ''} en ${r.ms} ms`;
const sinDetalleTecnico = (r) => !/(SELECT |INSERT |UPDATE |stack|at \w+ \(|node_modules|postgres:\/\/|ECONN|pg_)/i.test(JSON.stringify(r.json || r.texto || ''));
const mediana = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/* ---------------------------------------------------------------- pruebas */
async function main() {
  fs.mkdirSync(SALIDA, { recursive: true });
  const anon = new Sesion('anónimo');
  const admin = new Sesion('admin QA');
  const op = new Sesion('operador QA');
  const ti = new Sesion('TI QA');
  const ids = {};

  console.log(`API: ${API}\nFrontend: ${FRONT}\n`);

  /* ===== Disponibilidad ===== */
  const h = await anon.get('/api/health');
  caso('INF-01', 'RNF-19', 'Health check de la API con la base de datos', '200, status OK y database OK',
    h.status === 200 && h.json?.status === 'OK' && h.json?.database === 'OK', `${resumen(h)}, database=${h.json?.database}`);
  const fr = await anon.get('/login', { base: FRONT, headers: { Accept: 'text/html' } });
  caso('INF-02', 'RNF-17', 'Frontend publicado responde', '200 en /login', fr.status === 200, resumen(fr));
  const viaFront = await anon.get('/api/health', { base: FRONT });
  caso('INF-03', 'RNF-17', 'El frontend reenvía /api/* a la API (mismo origen)', '200 con database OK',
    viaFront.status === 200 && viaFront.json?.database === 'OK', resumen(viaFront));

  /* ===== Seguridad de transporte y cabeceras (RNF-06) ===== */
  for (const [id, base] of [['SEG-01', API], ['SEG-02', FRONT]]) {
    const r = await fetch(base.replace('https://', 'http://') + '/api/health', { redirect: 'manual' }).catch((e) => ({ status: 0, e }));
    const loc = r.headers?.get?.('location') || '';
    caso(id, 'RNF-06', `HTTP redirige a HTTPS (${new URL(base).host})`, '301/302/307/308 hacia https://',
      [301, 302, 307, 308].includes(r.status) && loc.startsWith('https://'), `HTTP ${r.status} → ${loc || '(sin Location)'}`);
  }
  const hsts = [h.headers.get('strict-transport-security'), fr.headers.get('strict-transport-security')];
  caso('SEG-03', 'RNF-06', 'Cabecera HSTS en API y frontend', 'Strict-Transport-Security presente en ambos',
    hsts.every(Boolean), `API: ${hsts[0] || 'ausente'} | Front: ${hsts[1] || 'ausente'}`);
  caso('SEG-04', 'RNF-06', 'La API no anuncia la tecnología del servidor', 'Sin X-Powered-By; con X-Content-Type-Options',
    !h.headers.get('x-powered-by') && h.headers.get('x-content-type-options') === 'nosniff',
    `x-powered-by=${h.headers.get('x-powered-by') || 'ausente'}, nosniff=${h.headers.get('x-content-type-options')}`);

  const corsMalo = await anon.get('/api/health', { headers: { Origin: 'https://sitio-ajeno.example' } });
  caso('SEG-05', 'RNF-06', 'CORS rechaza un origen no autorizado', '403 origen_no_permitido, sin Access-Control-Allow-Origin',
    corsMalo.status === 403 && !corsMalo.headers.get('access-control-allow-origin'), resumen(corsMalo));
  const corsBueno = await anon.get('/api/health', { headers: { Origin: FRONT } });
  caso('SEG-06', 'RNF-06', 'CORS acepta el origen del frontend', '200 con Access-Control-Allow-Origin = frontend',
    corsBueno.status === 200 && corsBueno.headers.get('access-control-allow-origin') === FRONT,
    `${resumen(corsBueno)}, ACAO=${corsBueno.headers.get('access-control-allow-origin')}`);

  /* ===== CU-07 Autenticar ===== */
  const lAdmin = await admin.login(QA.email, QA.password);
  tiempo('CU07-T1', 'CU-07', 'Inicio de sesión (pasos 4–6)', lAdmin.ms, 2000);
  caso('CU07-01', 'CU-07', 'Inicio de sesión con credenciales válidas (admin QA)', '200, rol administrador y cookie de sesión',
    lAdmin.status === 200 && lAdmin.json?.user?.rol === 'administrador' && !!admin.cookie, resumen(lAdmin));
  const ck = lAdmin.setCookie.find((c) => c.startsWith('nx_token=')) || '';
  caso('SEG-07', 'RNF-05', 'Cookie de sesión protegida', 'HttpOnly, Secure y SameSite=Lax',
    /HttpOnly/i.test(ck) && /Secure/i.test(ck) && /SameSite=Lax/i.test(ck), ck.replace(/nx_token=[^;]+/, 'nx_token=…'));

  const malPass = await anon.login(QA.email, 'Incorrecta123');
  const noExiste = await anon.login(`no-existe-${SUFIJO}@nexustock.test`, 'Incorrecta123');
  caso('CU07-02', 'CU-07', 'Credenciales inválidas: mensaje genérico (4a)', '401 con el mismo mensaje para clave errónea y correo inexistente',
    malPass.status === 401 && noExiste.status === 401 && malPass.json?.error?.message === noExiste.json?.error?.message,
    `${resumen(malPass)} / ${resumen(noExiste)} — «${malPass.json?.error?.message}»`);

  const sinSesion = await anon.get('/api/dashboard');
  caso('CU07-03', 'CU-07', 'Operación sin sesión', '401', sinSesion.status === 401, resumen(sinSesion));

  // Token alterado: firma «none» con el mismo contenido
  const [, payload] = (admin.cookie || '..').split('.');
  const falso = new Sesion('falso');
  falso.cookie = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;
  const rFalso = await falso.get('/api/auth/me');
  caso('CU07-04', 'CU-07', 'Token sin firma (alg none) rechazado (7a)', '401', rFalso.status === 401, resumen(rFalso));

  const csrf = await admin.post('/api/categories', { nombre: `QA-28 csrf ${SUFIJO}` }, { csrf: false });
  caso('SEG-08', 'RNF-06', 'CSRF: modificación con cookie pero sin cabecera x-nx-csrf', '403 y no se crea el registro',
    csrf.status === 403, resumen(csrf));

  /* ===== CU-12 Crear cuenta ===== */
  const setup = await anon.get('/api/auth/setup-status');
  caso('CU12-01', 'CU-12', 'Registro público cerrado con administrador existente', 'necesitaRegistro=false y registroAbierto=false',
    setup.json && !setup.json.necesitaRegistro && !setup.json.registroAbierto, JSON.stringify(setup.json));
  const reg = await anon.post('/api/auth/register', { nombre: 'Intruso', email: `qa-intruso-${SUFIJO}@nexustock.test`, password: 'Intruso2026x', negocio: 'Carnicería Intrusa', acepta_terminos: true });
  caso('CU12-02', 'CU-12', 'Alta inicial cuando ya hay administrador (2a)', '403 indicando pedir la cuenta al administrador',
    reg.status === 403, `${resumen(reg)} — «${reg.json?.error?.message}»`);

  const emailOp = `qa-operador-${SUFIJO}@nexustock.test`;
  const emailTi = `qa-ti-${SUFIJO}@nexustock.test`;
  const cOp = await admin.post('/api/users', { nombre: 'QA-28 Operador', email: emailOp, password: PASS_OP, rol: 'operador' });
  tiempo('CU12-T1', 'CU-12', 'Alta de usuario del equipo (pasos 4–6)', cOp.ms, 2000);
  caso('CU12-03', 'CU-12', 'Administrador crea un operador', '201, activo y rol operador',
    cOp.status === 201 && cOp.json?.data?.rol === 'operador' && cOp.json?.data?.activo, resumen(cOp));
  ids.op = cOp.json?.data?.id;
  const cTi = await admin.post('/api/users', { nombre: 'QA-28 Soporte TI', email: emailTi, password: PASS_TI, rol: 'ti' });
  caso('CU12-04', 'CU-12', 'Administrador crea un usuario TI', '201 y rol ti', cTi.status === 201 && cTi.json?.data?.rol === 'ti', resumen(cTi));
  ids.ti = cTi.json?.data?.id;
  const dup = await admin.post('/api/users', { nombre: 'Duplicado', email: emailOp, password: PASS_OP, rol: 'operador' });
  caso('CU12-05', 'CU-12', 'Correo ya registrado (4a)', '4xx informado junto al campo email',
    [400, 409].includes(dup.status) && campoDe(dup) === 'email', `${resumen(dup)} — ${detalleDe(dup)}`);
  const debil = await admin.post('/api/users', { nombre: 'Débil', email: `qa-debil-${SUFIJO}@nexustock.test`, password: 'corta', rol: 'operador' });
  caso('CU12-06', 'CU-12', 'Contraseña fuera de política (4b)', '400 con el detalle del campo password',
    debil.status === 400 && JSON.stringify(debil.json).includes('password'), resumen(debil));

  const lOp = await op.login(emailOp, PASS_OP);
  const lTi = await ti.login(emailTi, PASS_TI);
  tiempo('CU07-T2', 'CU-07', 'Inicio de sesión (operador)', lOp.ms, 2000);
  tiempo('CU07-T3', 'CU-07', 'Inicio de sesión (TI)', lTi.ms, 2000);
  caso('CU07-05', 'CU-07', 'Inicio de sesión de operador y TI recién creados', '200 en ambos', lOp.status === 200 && lTi.status === 200, `${resumen(lOp)} / ${resumen(lTi)}`);
  const opUsers = await op.post('/api/users', { nombre: 'Hackeo', email: `qa-x-${SUFIJO}@nexustock.test`, password: PASS_OP, rol: 'administrador' });
  caso('CU12-07', 'CU-12', 'Operador intenta crear cuentas (1a)', '403', opUsers.status === 403, resumen(opUsers));
  const opStatus = await op.get('/api/status');
  caso('CU07-06', 'CU-07', 'Rol sin permiso: operador en el panel técnico (7b)', '403 con mensaje claro', opStatus.status === 403, `${resumen(opStatus)} — «${opStatus.json?.error?.message}»`);

  /* ===== CU-04 Catálogo ===== */
  const cats = await admin.get('/api/categories');
  const catReal = (cats.json?.data || []).find((c) => c.productos > 0);
  const cCat = await admin.post('/api/categories', { nombre: `QA-28 Cat ${SUFIJO}` });
  tiempo('CU04-T1', 'CU-04', 'Crear categoría (pasos 6–8)', cCat.ms, 2000);
  caso('CU04-01', 'CU-04', 'Crear categoría', '201', cCat.status === 201, resumen(cCat));
  ids.cat = cCat.json?.data?.id_categoria;
  const cCatDup = await admin.post('/api/categories', { nombre: `QA-28 Cat ${SUFIJO}` });
  caso('CU04-02', 'CU-04', 'Nombre de categoría duplicado (6a)', '4xx informado junto al campo nombre',
    [400, 409].includes(cCatDup.status) && campoDe(cCatDup) === 'nombre', `${resumen(cCatDup)} — ${detalleDe(cCatDup)}`);

  const provBase = { contacto: 'QA', lead_time_dias: 2, dias_habiles: [1, 2, 3, 4, 5] };
  const pNeg = await admin.post('/api/suppliers', { ...provBase, nombre: `QA-28 Prov neg ${SUFIJO}`, lead_time_dias: -1 });
  const pSinDias = await admin.post('/api/suppliers', { ...provBase, nombre: `QA-28 Prov sd ${SUFIJO}`, dias_habiles: [] });
  caso('CU04-03', 'CU-04', 'Lead time negativo o sin días hábiles (6b)', '400 en ambos casos', pNeg.status === 400 && pSinDias.status === 400, `${resumen(pNeg)} / ${resumen(pSinDias)}`);
  const cProv = await admin.post('/api/suppliers', { ...provBase, nombre: `QA-28 Proveedor ${SUFIJO}` });
  tiempo('CU04-T2', 'CU-04', 'Crear proveedor (pasos 6–8)', cProv.ms, 2000);
  caso('CU04-04', 'CU-04', 'Crear proveedor', '201', cProv.status === 201, resumen(cProv));
  ids.prov = cProv.json?.data?.id_proveedor;
  const cProv2 = await admin.post('/api/suppliers', { ...provBase, nombre: `QA-28 Proveedor inactivo ${SUFIJO}` });
  ids.prov2 = cProv2.json?.data?.id_proveedor;
  const baja = await admin.patch(`/api/suppliers/${ids.prov2}/estado`, { activo: false });
  caso('CU04-05', 'CU-04', 'Baja lógica de proveedor sin productos', '200 y activo=false', baja.status === 200 && baja.json?.data?.activo === false, resumen(baja));

  const prodBase = { id_proveedor: ids.prov, unidad: 'kg', precio_venta_clp: 9990, stock_minimo: 5, vida_util_dias: 5, margen_seguridad_pct: 10 };
  const cProdB = await admin.post('/api/products', { ...prodBase, nombre: `QA-28 Corte B ${SUFIJO}`, id_categoria: ids.cat, stock_inicial: 10 });
  tiempo('CU04-T3', 'CU-04', 'Crear producto (pasos 6–8)', cProdB.ms, 2000);
  caso('CU04-06', 'CU-04', 'Crear producto con stock inicial', '201 y stock 10 kg', cProdB.status === 201 && cProdB.json?.data?.stock_actual === 10, resumen(cProdB));
  ids.prodB = cProdB.json?.data?.id_producto;
  const cProdA = await admin.post('/api/products', { ...prodBase, nombre: `QA-28 Corte A ${SUFIJO}`, id_categoria: catReal?.id_categoria, stock_inicial: 0 });
  ids.prodA = cProdA.json?.data?.id_producto;
  caso('CU04-07', 'CU-04', `Crear producto nuevo sin historial en categoría con datos (${catReal?.nombre})`, '201', cProdA.status === 201, resumen(cProdA));
  const cProdMal = await admin.post('/api/products', { ...prodBase, nombre: `QA-28 Malo ${SUFIJO}`, id_categoria: 999999, stock_inicial: 0 });
  caso('CU04-08', 'CU-04', 'Producto con identificador de categoría fuera de rango (6)', '400 junto al campo id_categoria', cProdMal.status === 400 && campoDe(cProdMal) === 'id_categoria', `${resumen(cProdMal)} — ${detalleDe(cProdMal)}`);
  const cProdMal2 = await admin.post('/api/products', { ...prodBase, nombre: `QA-28 Malo2 ${SUFIJO}`, id_categoria: 9999, stock_inicial: 0 });
  caso('CU04-12', 'CU-04', 'Producto con categoría inexistente (6)', '400 junto al campo id_categoria', cProdMal2.status === 400 && campoDe(cProdMal2) === 'id_categoria', `${resumen(cProdMal2)} — ${detalleDe(cProdMal2)}`);
  const edit = await admin.put(`/api/products/${ids.prodB}`, { ...prodBase, nombre: `QA-28 Corte B ${SUFIJO}`, id_categoria: ids.cat, precio_venta_clp: 10490 });
  tiempo('CU04-T4', 'CU-04', 'Editar producto (pasos 6–8)', edit.ms, 2000);
  caso('CU04-09', 'CU-04', 'Editar precio del producto', '200 y precio 10.490', edit.status === 200 && edit.json?.data?.precio_venta_clp === 10490, resumen(edit));
  const opCat = await op.post('/api/categories', { nombre: `QA-28 op ${SUFIJO}` });
  caso('CU04-10', 'CU-04', 'Operador intenta modificar el catálogo', '403', opCat.status === 403, resumen(opCat));

  /* ===== CU-02 Compras ===== */
  const compra = await op.post('/api/purchases', { id_producto: ids.prodB, cantidad: 20, costo_unitario_clp: 5000 });
  tiempo('CU02-T1', 'CU-02', 'Registrar compra (pasos 7–8)', compra.ms, 2000);
  const dc = compra.json?.data || {};
  caso('CU02-01', 'CU-02', 'Operador registra recepción de 20 kg', '201, stock 10→30 y costo total 100.000',
    compra.status === 201 && dc.stock_nuevo === 30 && dc.costo_total_clp === 100000, `${resumen(compra)}, stock ${dc.stock_anterior}→${dc.stock_nuevo}, total ${dc.costo_total_clp}`);
  const compra0 = await op.post('/api/purchases', { id_producto: ids.prodB, cantidad: 0, costo_unitario_clp: 5000 });
  caso('CU02-02', 'CU-02', 'Cantidad cero (4a)', '400 y no se registra', compra0.status === 400, resumen(compra0));
  const compraInact = await op.post('/api/purchases', { id_producto: ids.prodB, id_proveedor: ids.prov2, cantidad: 1, costo_unitario_clp: 5000 });
  caso('CU02-03', 'CU-02', 'Proveedor inactivo (4b)', '400 junto al campo id_proveedor', compraInact.status === 400 && JSON.stringify(compraInact.json).includes('id_proveedor'), resumen(compraInact));
  const compraTi = await ti.post('/api/purchases', { id_producto: ids.prodB, cantidad: 1, costo_unitario_clp: 5000 });
  caso('CU02-04', 'CU-02', 'Rol TI no registra compras (1a)', '403', compraTi.status === 403, resumen(compraTi));

  /* ===== CU-01 Ventas ===== */
  const venta = await op.post('/api/sales', { id_producto: ids.prodB, cantidad: 3 });
  tiempo('CU01-T1', 'CU-01', 'Registrar venta (pasos 7–8)', venta.ms, 2000);
  const dv = venta.json?.data || {};
  caso('CU01-01', 'CU-01', 'Operador vende 3 kg con precio del catálogo', '201, total 3 × 10.490 = 31.470 y stock 30→27',
    venta.status === 201 && dv.total_clp === 31470 && dv.stock_nuevo === 27, `${resumen(venta)}, total ${dv.total_clp}, stock ${dv.stock_anterior}→${dv.stock_nuevo}`);
  const vNeg = await op.post('/api/sales', { id_producto: ids.prodB, cantidad: -1 });
  const vTxt = await op.post('/api/sales', { id_producto: ids.prodB, cantidad: 'diez' });
  tiempo('CU01-T2', 'CU-01', 'Validación de datos (paso 4)', vNeg.ms, 1000);
  caso('CU01-02', 'CU-01', 'Cantidad negativa o no numérica (4a)', '400 en ambos', vNeg.status === 400 && vTxt.status === 400, `${resumen(vNeg)} / ${resumen(vTxt)}`);
  const vMas = await op.post('/api/sales', { id_producto: ids.prodB, cantidad: 999 });
  caso('CU01-03', 'CU-01', 'Cantidad mayor al stock (4b)', '409 «supera el stock disponible»', vMas.status === 409 && /stock/i.test(JSON.stringify(vMas.json)), `${resumen(vMas)} — «${vMas.json?.error?.message || ''}»`);
  // 7a: dos ventas simultáneas de 15 kg con 27 kg disponibles → solo una puede registrarse
  const [c1, c2] = await Promise.all([
    op.post('/api/sales', { id_producto: ids.prodB, cantidad: 15 }),
    admin.post('/api/sales', { id_producto: ids.prodB, cantidad: 15 })
  ]);
  const okConc = [c1, c2].filter((r) => r.status === 201).length;
  const det = await admin.get(`/api/products/${ids.prodB}`);
  caso('CU01-04', 'CU-01', 'Dos ventas simultáneas de 15 kg con 27 kg en stock (7a, RNF-11, RNF-13)', 'Una 201 y otra 409; stock final 12, nunca negativo',
    okConc === 1 && det.json?.data?.stock_actual === 12, `${c1.status} / ${c2.status}, stock final ${det.json?.data?.stock_actual}`);
  const vTi = await ti.post('/api/sales', { id_producto: ids.prodB, cantidad: 1 });
  caso('CU01-05', 'CU-01', 'Rol TI no registra ventas (1a)', '403', vTi.status === 403, resumen(vTi));
  // Bajar el stock bajo el mínimo (5 kg) para que el semáforo genere alerta
  const vBaja = await op.post('/api/sales', { id_producto: ids.prodB, cantidad: 9 });
  caso('CU01-06', 'CU-01', 'Venta que deja el stock bajo el mínimo', '201 y stock 3 kg', vBaja.status === 201 && vBaja.json?.data?.stock_nuevo === 3, resumen(vBaja));
  const delHist = await admin.del(`/api/products/${ids.prodB}`);
  caso('CU04-11', 'CU-04', 'Eliminar producto con ventas (3a, RNF-10)', '409 ofreciendo la baja lógica', delHist.status === 409 && /desactivar/i.test(delHist.json?.error?.message || ''), resumen(delHist));

  /* ===== CU-08 / CU-10 / CU-11 Predicción ===== */
  const prods = await admin.get('/api/products');
  const real = (prods.json?.data || []).filter((p) => !p.nombre.startsWith('QA-28') && p.origen_demanda === 'modelo')[0]
    || (prods.json?.data || []).find((p) => !p.nombre.startsWith('QA-28'));
  const g1 = await admin.post('/api/predictions/generar', { id_producto: real.id_producto, horizonte: 'semana' });
  tiempo('CU08-T1', 'CU-08', `Generar predicción con el modelo (${real.nombre})`, g1.ms, 2000);
  const d1 = g1.json?.data || {};
  caso('CU08-01', 'CU-08', `Predicción semanal con el modelo activo (${real.nombre})`, '201, origen modelo, demanda > 0 y latencia del motor < 2.000 ms',
    g1.status === 201 && d1.origen === 'modelo' && d1.demanda > 0 && d1.latencia_ms < 2000,
    `${resumen(g1)}, origen ${d1.origen}, demanda ${d1.demanda} ${d1.unidad}, latencia motor ${d1.latencia_ms} ms`);
  const g1b = await admin.post('/api/predictions/generar', { id_producto: real.id_producto, horizonte: 'semana' });
  caso('CU10-01', 'CU-10', 'Una sola predicción por producto, horizonte y fecha objetivo', 'El segundo cálculo reemplaza al primero (mismo id)',
    g1b.status === 201 && g1b.json?.data?.id_prediccion === d1.id_prediccion, `ids ${d1.id_prediccion} / ${g1b.json?.data?.id_prediccion}`);
  const gm = await admin.post('/api/predictions/generar', { id_producto: real.id_producto, horizonte: 'mes' });
  caso('CU08-02', 'CU-08', 'Predicción mensual', '201, horizonte mes y 28–31 días', gm.status === 201 && gm.json?.data?.horizonte === 'mes', `${resumen(gm)}, origen ${gm.json?.data?.origen}, demanda ${gm.json?.data?.demanda}`);
  const gA = await admin.post('/api/predictions/generar', { id_producto: ids.prodA, horizonte: 'semana' });
  tiempo('CU11-T1', 'CU-11', 'Respaldo por categoría', gA.ms, 1000);
  caso('CU11-01', 'CU-11', 'Producto nuevo sin historial: respaldo por categoría (CU-08 1a)', '201, origen categoria, sin modelo, demanda > 0',
    gA.status === 201 && gA.json?.data?.origen === 'categoria' && gA.json?.data?.demanda > 0, `${resumen(gA)}, origen ${gA.json?.data?.origen}, demanda ${gA.json?.data?.demanda}`);
  // Producto B: ya tiene ventas (27 kg hoy) → promedio histórico de la ventana (divisor mínimo de 7 días)
  const gB = await admin.post('/api/predictions/generar', { id_producto: ids.prodB, horizonte: 'semana' });
  caso('CU11-02', 'CU-11', 'Producto con historial propio: respaldo por promedio histórico (3)', '201, origen promedio_historico y demanda 27 kg (27 kg vendidos ÷ 7 días × 7)',
    gB.status === 201 && gB.json?.data?.origen === 'promedio_historico' && gB.json?.data?.demanda === 27, `${resumen(gB)}, origen ${gB.json?.data?.origen}, demanda ${gB.json?.data?.demanda}`);
  // Producto C: nuevo, en una categoría sin ningún historial → sin proyección
  const cCat2 = await admin.post('/api/categories', { nombre: `QA-28 Vacía ${SUFIJO}` });
  const cProdC = await admin.post('/api/products', { ...prodBase, nombre: `QA-28 Corte C ${SUFIJO}`, id_categoria: cCat2.json?.data?.id_categoria, stock_inicial: 4 });
  ids.prodC = cProdC.json?.data?.id_producto;
  const gC = await admin.post('/api/predictions/generar', { id_producto: ids.prodC, horizonte: 'semana' });
  caso('CU11-03', 'CU-11', 'Producto nuevo en categoría sin historial (4a)', 'Origen categoria con demanda 0 (sin proyección)',
    gC.status === 201 && gC.json?.data?.origen === 'categoria' && gC.json?.data?.demanda === 0, `${resumen(gC)}, origen ${gC.json?.data?.origen}, demanda ${gC.json?.data?.demanda}`);
  const gOp = await op.post('/api/predictions/generar', { id_producto: ids.prodB, horizonte: 'semana' });
  caso('CU08-03', 'CU-08', 'Operador no puede forzar el cálculo', '403', gOp.status === 403, resumen(gOp));
  const gBad = await admin.post('/api/predictions/generar', { id_producto: real.id_producto, horizonte: 'anio' });
  caso('CU10-02', 'CU-10', 'Horizonte no permitido (2a)', '400', gBad.status === 400, resumen(gBad));

  /* ===== CU-09 Semáforo y sugerencias ===== */
  const ev = await admin.post('/api/alerts/evaluate', {});
  caso('CU09-01', 'CU-09', 'Recalcular proyecciones y alertas de todos los productos', '200 con productos evaluados', ev.status === 200 && ev.json?.data?.evaluados > 0, `${resumen(ev)}, ${JSON.stringify(ev.json?.data)}`);
  const recs = [];
  for (let i = 0; i < 5; i++) recs.push(await admin.get('/api/alerts/recommendations'));
  recs.forEach((r, i) => tiempo(`CU09-T${i + 1}`, 'CU-09', 'Semáforo y sugerencias del conjunto de productos', r.ms, 1000));
  const rec = recs[recs.length - 1].json || {};
  const sugB = (rec.sugerencias || []).find((s) => s.id_producto === ids.prodB);
  caso('CU09-02', 'CU-09', 'Producto con 3 kg y demanda de 27 kg/semana queda en quiebre (2)', 'Nivel quiebre con cantidad sugerida y fecha límite',
    !!sugB && sugB.nivel === 'quiebre' && sugB.cantidad_sugerida > 0 && !!sugB.fecha_limite_pedido,
    sugB ? `nivel ${sugB.nivel}, demanda ${sugB.demanda_semana}, sugerido ${sugB.cantidad_sugerida} kg${sugB.cantidad_acotada_vida_util ? ' (acotado por vida útil)' : ''}, límite ${sugB.fecha_limite_pedido}` : 'sin sugerencia');
  const sugC = (rec.sugerencias || []).find((s) => s.id_producto === ids.prodC);
  caso('CU09-05', 'CU-09', 'Sin demanda proyectada: umbral por stock mínimo (2a)', 'Producto C con 4 kg y mínimo 5 kg en nivel bajo',
    !!sugC && sugC.nivel === 'bajo', sugC ? `nivel ${sugC.nivel}, demanda ${sugC.demanda_semana}, sugerido ${sugC.cantidad_sugerida}` : 'sin sugerencia');
  const sem = rec.semaforo || {};
  caso('CU09-03', 'CU-09', 'Semáforo consolidado', 'quiebre + bajo + óptimo = total', sem.quiebre + sem.bajo + sem.optimo === sem.total, JSON.stringify(sem));
  const sugReal = (rec.sugerencias || []).filter((s) => !String(s.producto).startsWith('QA-28'));
  const sugOk = sugReal.every((s) => s.cantidad_sugerida >= 0 && (!s.fecha_limite_pedido || s.fecha_limite_pedido >= rec.hoy));
  caso('CU09-04', 'CU-09', 'Sugerencias coherentes en productos reales', 'Cantidades ≥ 0 y fecha límite no anterior a hoy', sugOk, `${sugReal.length} sugerencias, hoy=${rec.hoy}`);

  /* ===== CU-03 Dashboard ===== */
  const dash = [];
  for (let i = 0; i < 5; i++) dash.push(await admin.get('/api/dashboard'));
  dash.forEach((r, i) => tiempo(`CU03-T${i + 1}`, 'CU-03', 'Carga del dashboard (API directa)', r.ms, 3000));
  const dashFront = [];
  for (let i = 0; i < 3; i++) dashFront.push(await admin.get('/api/dashboard', { base: FRONT }));
  dashFront.forEach((r, i) => tiempo(`CU03-TF${i + 1}`, 'CU-03', 'Carga del dashboard (vía frontend Vercel)', r.ms, 3000));
  const dj = dash[0].json || {};
  caso('CU03-01', 'CU-03', 'Dashboard con indicadores, semáforo y tendencia', '200 con datos del inventario',
    dash[0].status === 200 && Object.keys(dj).length > 0, `${resumen(dash[0])}, claves: ${Object.keys(dj.data || dj).slice(0, 8).join(', ')}`);
  caso('CU03-02', 'CU-03', 'Dashboard sin sesión (2a)', '401', sinSesion.status === 401, resumen(sinSesion));

  /* ===== CU-05 Alertas ===== */
  const al = await admin.get('/api/alerts');
  tiempo('CU05-T1', 'CU-05', 'Listar alertas activas (paso 2)', al.ms, 2000);
  const lista = al.json?.data || [];
  const aB = lista.find((a) => a.id_producto === ids.prodB);
  const aA = lista.find((a) => a.id_producto === ids.prodA);
  caso('CU05-01', 'CU-05', 'Alerta activa del producto de prueba con su detalle', 'Nivel, stock, sugerencia, proveedor, lead time y fecha límite',
    !!aB && aB.nivel && aB.cantidad_sugerida != null && aB.lead_time_dias != null && aB.fecha_limite_pedido,
    aB ? `alerta ${aB.id_alerta}: ${aB.nivel}, stock ${aB.stock_actual}, sugerido ${aB.cantidad_sugerida}, límite ${aB.fecha_limite_pedido}` : 'sin alerta');
  const ordenado = lista.every((a, i) => i === 0 || ({ quiebre: 0, bajo: 1 }[lista[i - 1].nivel] ?? 2) <= ({ quiebre: 0, bajo: 1 }[a.nivel] ?? 2));
  caso('CU05-02', 'CU-05', 'Alertas ordenadas por nivel de riesgo (paso 2)', 'quiebre antes que bajo', ordenado, `${lista.length} alertas activas`);
  if (aB) {
    const opAt = await op.patch(`/api/alerts/${aB.id_alerta}`, { estado: 'atendida' });
    caso('CU05-03', 'CU-05', 'Operador intenta atender una alerta', '403', opAt.status === 403, resumen(opAt));
    const at = await admin.patch(`/api/alerts/${aB.id_alerta}`, { estado: 'atendida' });
    tiempo('CU05-T2', 'CU-05', 'Atender alerta (paso 6)', at.ms, 1000);
    caso('CU05-04', 'CU-05', 'Atender alerta', '200, estado atendida con fecha de resolución', at.status === 200 && at.json?.data?.estado === 'atendida' && !!at.json?.data?.resuelta_en, `${resumen(at)}, resuelta_en ${at.json?.data?.resuelta_en}`);
    const at2 = await admin.patch(`/api/alerts/${aB.id_alerta}`, { estado: 'descartada' });
    caso('CU05-05', 'CU-05', 'Alerta ya resuelta desde otra sesión (3a)', '409 ya_resuelta', at2.status === 409, `${resumen(at2)} — «${at2.json?.error?.message}»`);
  }
  if (aA) {
    const ds = await admin.patch(`/api/alerts/${aA.id_alerta}`, { estado: 'descartada' });
    caso('CU05-06', 'CU-05', 'Descartar alerta', '200, estado descartada', ds.status === 200 && ds.json?.data?.estado === 'descartada', resumen(ds));
  }
  const alDespues = await admin.get('/api/alerts');
  caso('CU05-07', 'CU-05', 'Las alertas resueltas dejan de figurar como activas', 'Sin alertas activas de los productos de prueba',
    !(alDespues.json?.data || []).some((a) => [ids.prodA, ids.prodB].includes(a.id_producto)), `${(alDespues.json?.data || []).length} alertas activas`);

  /* ===== CU-06 Modelo ===== */
  const mods = await ti.get('/api/models');
  tiempo('CU06-T0', 'CU-06', 'Consultar precisión del modelo', mods.ms, 2000);
  const activo = mods.json?.data?.activo;
  caso('CU06-01', 'CU-06', 'TI consulta el modelo activo y su MAE', '200 con modelo activo, MAE general y festivo',
    mods.status === 200 && !!activo && activo.mae_general > 0, activo ? `${activo.algoritmo} ${activo.version}, MAE ${activo.mae_general} / festivos ${activo.mae_festivos}, mejora ${mods.json.data.mejora_general_pct} %` : resumen(mods));
  const opMods = await op.get('/api/models');
  caso('CU06-02', 'CU-06', 'Operador no accede a la precisión del modelo', '403', opMods.status === 403, resumen(opMods));
  const modBase = { algoritmo: 'QA-28 prueba', mae_general: (activo?.mae_general || 1) + 1, mae_festivos: 5, entrenado_desde: '2022-01-01', entrenado_hasta: '2023-12-31', prueba_desde: '2024-01-01', prueba_hasta: '2024-09-28' };
  const mNo = await ti.post('/api/models', { ...modBase, version: `qa28-n${SUFIJO}`.slice(0, 20), artefacto_ruta: 'models/no-existe-qa28.joblib' });
  caso('CU06-03', 'CU-06', 'Artefacto inexistente (4a)', '400 junto al campo artefacto_ruta', mNo.status === 400 && JSON.stringify(mNo.json).includes('artefacto_ruta'), resumen(mNo));
  const mFechas = await ti.post('/api/models', { ...modBase, version: `qa28-f${SUFIJO}`.slice(0, 20), prueba_hasta: '2023-01-01', artefacto_ruta: activo?.artefacto_ruta });
  caso('CU06-04', 'CU-06', 'Fechas de prueba inválidas (4b)', '400', mFechas.status === 400, resumen(mFechas));
  const mOk = await ti.post('/api/models', { ...modBase, version: `qa28-v${SUFIJO}`.slice(0, 20), artefacto_ruta: activo?.artefacto_ruta });
  tiempo('CU06-T1', 'CU-06', 'Registrar versión del modelo (pasos 4–5)', mOk.ms, 2000);
  caso('CU06-05', 'CU-06', 'Registrar versión con artefacto existente', '201 en estado inactivo', mOk.status === 201 && mOk.json?.data?.activo === false, resumen(mOk));
  if (mOk.json?.data?.id_modelo) {
    const act = await ti.patch(`/api/models/${mOk.json.data.id_modelo}/activar`, {});
    caso('CU06-06', 'CU-06', 'Activar versión con MAE peor sin confirmar (6a)', '409 requiere_confirmacion y el modelo activo no cambia',
      act.status === 409 && act.json?.error?.code === 'requiere_confirmacion', `${resumen(act)} — «${act.json?.error?.message}»`);
    const sigue = await ti.get('/api/models');
    caso('CU06-07', 'CU-06', 'Existe un único modelo activo y sigue siendo el original', `Activo ${activo?.version}`,
      sigue.json?.data?.activo?.id_modelo === activo?.id_modelo, `activo ${sigue.json?.data?.activo?.version}`);
  }

  /* ===== CU-13 Recuperar contraseña ===== */
  const f1 = await anon.post('/api/auth/forgot', { email: emailOp });
  const f2 = await anon.post('/api/auth/forgot', { email: `qa-nadie-${SUFIJO}@nexustock.test` });
  tiempo('CU13-T1', 'CU-13', 'Solicitar enlace (paso 2)', f1.ms, 2000);
  caso('CU13-01', 'CU-13', 'Mensaje neutro: no revela si el correo existe (2)', '202 con la misma respuesta para correo existente e inexistente',
    f1.status === 202 && f2.status === 202 && JSON.stringify(f1.json) === JSON.stringify(f2.json), `${resumen(f1)} / ${resumen(f2)}`);
  const rl = await ti.post(`/api/users/${ids.op}/reset-link`, {});
  caso('CU13-02', 'CU-13', 'TI emite el enlace de restablecimiento asistido (1b)', '200 con enlace de 30 minutos', rl.status === 200 && rl.json?.data?.vence_en_minutos === 30, resumen(rl));
  const rlAdm = await admin.post(`/api/users/${ids.op}/reset-link`, {});
  caso('CU13-03', 'CU-13', 'Solo el rol TI emite enlaces asistidos', '403 para administrador', rlAdm.status === 403, resumen(rlAdm));
  const token = new URL(rl.json?.data?.enlace || 'http://x/?token=').searchParams.get('token') || (rl.json?.data?.enlace || '').split('token=')[1];
  const antes = await op.get('/api/auth/me');
  const rDebil = await anon.post('/api/auth/reset', { token, password: 'debil' });
  caso('CU13-04', 'CU-13', 'Nueva contraseña fuera de política (5a)', '400', rDebil.status === 400, resumen(rDebil));
  const nueva = `Nueva${SUFIJO}Clave9`;
  const rOk = await anon.post('/api/auth/reset', { token, password: nueva });
  tiempo('CU13-T2', 'CU-13', 'Restablecer contraseña (paso 6)', rOk.ms, 2000);
  caso('CU13-05', 'CU-13', 'Restablecer con enlace válido', '200', rOk.status === 200, resumen(rOk));
  const despues = await op.get('/api/auth/me');
  caso('CU13-06', 'CU-13', 'Las sesiones anteriores quedan invalidadas (6)', 'Sesión del operador: 200 antes y 401 después', antes.status === 200 && despues.status === 401, `${antes.status} → ${despues.status}`);
  const rUsado = await anon.post('/api/auth/reset', { token, password: `Otra${SUFIJO}Clave8` });
  caso('CU13-07', 'CU-13', 'Enlace ya usado (4a)', '400 enlace_invalido', rUsado.status === 400 && rUsado.json?.error?.code === 'enlace_invalido', resumen(rUsado));
  const lNueva = await op.login(emailOp, nueva);
  caso('CU13-08', 'CU-13', 'Inicio de sesión con la nueva contraseña', '200', lNueva.status === 200, resumen(lNueva));

  /* ===== CU-07 4b: cuenta inactiva ===== */
  const desact = await admin.patch(`/api/users/${ids.ti}`, { activo: false });
  const tiMe = await ti.get('/api/auth/me');
  const lInact = await anon.login(emailTi, PASS_TI);
  caso('CU07-07', 'CU-07', 'Cuenta desactivada (4b): sesión vigente y nuevo ingreso rechazados', 'Sesión 401 y login 401 con el mensaje genérico',
    desact.status === 200 && tiMe.status === 401 && lInact.status === 401 && lInact.json?.error?.message === malPass.json?.error?.message,
    `desactivar ${desact.status}, sesión ${tiMe.status}, login ${lInact.status}`);
  const autoBaja = await admin.patch(`/api/users/${lAdmin.json?.user?.id}`, { activo: false });
  caso('CU07-08', 'CU-07', 'Un administrador no puede desactivar su propia cuenta', '409 usuario_propio', autoBaja.status === 409, resumen(autoBaja));

  /* ===== Errores sin detalles técnicos (RNF-08, RNF-09) ===== */
  const malJson = await admin.post('/api/sales', '{"id_producto": 1,');
  const idMalo = await admin.get('/api/products/abc');
  const ruta = await admin.get('/api/no-existe');
  caso('SEG-09', 'RNF-08', 'Errores sin detalles técnicos (JSON inválido, id inválido, ruta inexistente)', '4xx con código y mensaje, sin SQL ni trazas',
    [malJson, idMalo, ruta].every((r) => r.status >= 400 && r.status < 500 && sinDetalleTecnico(r)), `${resumen(malJson)} / ${resumen(idMalo)} / ${resumen(ruta)}`);

  /* ===== Panel técnico sin secretos (RNF-07) ===== */
  const st = await admin.get('/api/status', { crudo: true });
  const stTxt = st.texto || '';
  caso('SEG-10', 'RNF-07', 'El panel /api/status no expone credenciales', '200 sin cadenas de conexión, secretos ni contraseñas',
    st.status === 200 && !/postgres(ql)?:\/\/|password|secret["']?\s*:\s*["'][^"']{6,}|smtps?:\/\/[^"]*@/i.test(stTxt), `${resumen(st)}, ${stTxt.length} bytes`);
  fs.writeFileSync(path.join(SALIDA, 'api-status.json'), JSON.stringify(st.json, null, 2));

  /* ===== Paquete del frontend sin secretos (RNF-07) ===== */
  const html = await anon.get('/login', { base: FRONT, crudo: true, headers: { Accept: 'text/html' } });
  const scripts = [...new Set((html.texto || '').match(/\/_next\/static\/[^"'\s]+\.js/g) || [])];
  let hallazgos = [];
  for (const s of scripts) {
    const js = await (await fetch(FRONT + s)).text();
    const m = js.match(/postgres(ql)?:\/\/[^"'\s]+|JWT_SECRET|SUPABASE_DB_URL|service_role|sb_secret_|SMTP_URL|nexustock-dev-secret/gi);
    if (m) hallazgos.push(`${s}: ${[...new Set(m)].join(', ')}`);
  }
  caso('SEG-11', 'RNF-07', 'El JavaScript público del frontend no contiene credenciales', 'Ninguna cadena de conexión ni nombre de secreto',
    scripts.length > 0 && hallazgos.length === 0, `${scripts.length} archivos revisados${hallazgos.length ? ` — ${hallazgos.join(' | ')}` : ''}`);

  /* ===== Límite de intentos (RNF-09): el contador debe seguir a la IP real del cliente ===== */
  // Cuatro solicitudes seguidas desde el mismo equipo deben descontar del MISMO contador (remaining estrictamente decreciente)
  const restante = (r) => Number(((r.headers.get('ratelimit') || '').match(/remaining=(\d+)/) || [])[1]);
  const seguidas = [];
  for (let i = 0; i < 4; i++) seguidas.push(restante(await anon.post('/api/auth/forgot', { email: `qa-rl-${SUFIJO}@nexustock.test` })));
  const decreciente = seguidas.every((v, i) => i === 0 || v === seguidas[i - 1] - 1);
  caso('SEG-12', 'RNF-09', 'El límite de intentos cuenta por cliente (4 solicitudes seguidas del mismo equipo)', 'remaining decrece de uno en uno en un único contador',
    decreciente, `remaining: ${seguidas.join(' → ')}${decreciente ? '' : ' — el contador cambia entre solicitudes: la clave no es la IP del cliente'}`);

  /* ===== Concurrencia y pool de conexiones ===== */
  const N = 30;
  const t0 = performance.now();
  const lote = await Promise.all(Array.from({ length: N }, (_, i) => admin.get(i % 3 === 0 ? '/api/dashboard' : i % 3 === 1 ? '/api/products' : '/api/alerts/recommendations')));
  const total = Math.round(performance.now() - t0);
  const st5 = lote.filter((r) => r.status >= 500).length;
  const msLote = lote.map((r) => r.ms);
  caso('CAR-01', 'RNF-03 / RNF-12', `${N} consultas simultáneas (dashboard, productos y sugerencias)`, 'Sin errores 5xx; el pool encola sin agotar el pooler',
    st5 === 0 && lote.every((r) => r.status === 200), `${lote.filter((r) => r.status === 200).length}/${N} con 200${lote.some((r) => r.status !== 200) ? ` (otros: ${lote.filter((r) => r.status !== 200).map((r) => resumen(r)).join(', ')})` : ''}, mediana ${mediana(msLote)} ms, máx ${Math.max(...msLote)} ms, lote ${total} ms`);
  const h2 = await anon.get('/api/health');
  caso('CAR-02', 'RNF-19', 'La API sigue sana tras la carga', '200 database OK', h2.status === 200 && h2.json?.database === 'OK', resumen(h2));

  /* ===== Cierre de sesión ===== */
  const viejo = admin.cookie;
  const lo = await admin.post('/api/auth/logout', {});
  const reuso = new Sesion('reuso');
  reuso.cookie = viejo;
  const meReuso = await reuso.get('/api/auth/me');
  caso('CU07-09', 'CU-07', 'Cerrar sesión elimina la cookie', '204 y Set-Cookie que vence nx_token', lo.status === 204 && lo.setCookie.some((c) => /nx_token=;/.test(c)), resumen(lo));
  caso('CU07-10', 'CU-07', 'Reutilizar el token copiado después de cerrar sesión', 'Idealmente 401 (revocación del lado del servidor)',
    meReuso.status === 401, `HTTP ${meReuso.status}${meReuso.status === 200 ? ' — el JWT sigue vigente hasta su expiración (8 h)' : ''}`, { observacion: true, severidad: 'Baja' });

  /* ===== Salida ===== */
  const aprobados = resultados.filter((r) => r.resultado === 'Aprobado').length;
  const observaciones = resultados.filter((r) => r.resultado === 'Observación').length;
  const fallidos = resultados.length - aprobados - observaciones;
  const salida = { fecha: new Date().toISOString(), api: API, frontend: FRONT, ids, aprobados, observaciones, fallidos, resultados, tiempos };
  const archivo = path.join(SALIDA, `sistema-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
  fs.writeFileSync(archivo, JSON.stringify(salida, null, 2));
  console.log(`\n${aprobados}/${resultados.length} aprobados, ${observaciones} observaciones, ${fallidos} fallidos. Tiempos fuera de cota: ${tiempos.filter((t) => !t.cumple).map((t) => `${t.id} ${t.ms} ms`).join(', ') || 'ninguno'}`);
  console.log(`Resultados: ${archivo}`);
  process.exitCode = fallidos ? 1 : 0;
}

main().catch((e) => {
  console.error('Error inesperado en el runner:', e);
  process.exit(1);
});
