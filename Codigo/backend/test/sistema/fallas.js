/**
 * Escenarios de falla de la tarea #28 (motor caído o lento, valores no viables y base de datos no disponible).
 * Se ejecutan contra una instancia LOCAL desechable (ver README.md de esta carpeta), nunca contra la demo:
 * detener la base o cambiar el motor afecta a todos los usuarios del entorno.
 *
 * Uso (desde Codigo/backend):
 *   QA_EMAIL=... QA_PASSWORD=... node test/sistema/fallas.js --api http://localhost:4111 --escenario motor-caido
 *   escenarios: motor-normal | motor-lento | motor-caido | motor-invalido | bd  (bd requiere --contenedor-bd)
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const arg = (n, def) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const API = arg('api', 'http://localhost:4110').replace(/\/$/, '');
const ESC = arg('escenario', 'motor-normal');
const SALIDA = arg('salida', path.join(__dirname, 'resultados'));
const CONTENEDOR = arg('contenedor-bd', '');
const QA = { email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD };
const resultados = [];
let cookie = null;

async function pedir(metodo, ruta, body) {
  const h = { Accept: 'application/json' };
  if (body !== undefined) Object.assign(h, { 'Content-Type': 'application/json', 'x-nx-csrf': '1' });
  if (cookie) h.Cookie = `nx_token=${cookie}`;
  const t0 = performance.now();
  try {
    const r = await fetch(API + ruta, { method: metodo, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const texto = await r.text();
    for (const c of r.headers.getSetCookie?.() || []) {
      const m = c.match(/^nx_token=([^;]*)/);
      if (m) cookie = m[1] || null;
    }
    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {
      /* no JSON */
    }
    return { status: r.status, json, texto, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { status: 0, json: null, texto: String(e), ms: Math.round(performance.now() - t0) };
  }
}
const sinDetalle = (r) => !/(SELECT |INSERT |stack|Traceback|MemoryError|node_modules|ECONN|postgres:\/\/|predict\.py)/i.test(r.texto || '');
const res = (r) => `HTTP ${r.status}${r.json?.error ? ` ${r.json.error.code}` : ''} en ${r.ms} ms`;
function caso(id, descripcion, esperado, cond, obtenido) {
  const ok = !!cond;
  resultados.push({ id, escenario: ESC, descripcion, esperado, obtenido, resultado: ok ? 'Aprobado' : 'Fallido' });
  console.log(`${ok ? '✔' : '✘'} ${id} ${descripcion} — ${obtenido}`);
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function escenarioMotor() {
  const l = await pedir('POST', '/api/auth/login', QA);
  if (l.status !== 200) throw new Error(`login ${l.status}`);
  const prods = (await pedir('GET', '/api/products')).json?.data || [];
  const p = prods.find((x) => x.ultima_venta) || prods[0];
  const esperado = ESC === 'motor-normal' ? 'modelo' : 'promedio_historico';
  const tag = ESC.toUpperCase().replace('MOTOR-', 'F-M-');

  // RNF-02: mientras el motor calcula (o se agota su plazo), el servidor sigue atendiendo otras solicitudes
  const [g, otra] = await Promise.all([
    pedir('POST', '/api/predictions/generar', { id_producto: p.id_producto, horizonte: 'semana' }),
    dormir(300).then(() => pedir('GET', '/api/products'))
  ]);
  caso(`${tag}-01`, `Predicción de «${p.nombre}» con ${ESC}`, `201, origen ${esperado}${esperado === 'modelo' ? '' : ' (respaldo RF-11)'}, sin detalles técnicos`,
    g.status === 201 && g.json?.data?.origen === esperado && sinDetalle(g),
    `${res(g)}, origen ${g.json?.data?.origen}, respaldo ${g.json?.data?.respaldo}, demanda ${g.json?.data?.demanda}, latencia motor ${g.json?.data?.latencia_ms}`);
  caso(`${tag}-02`, 'Tiempo total de la predicción', ESC === 'motor-lento' ? 'Corte del motor a los 2,0 s y respuesta con respaldo antes de 3 s' : 'Menos de 2,0 s',
    ESC === 'motor-lento' ? g.ms >= 1900 && g.ms < 3000 : g.ms < 2000, `${g.ms} ms`);
  caso(`${tag}-03`, 'El servidor no se bloquea durante la inferencia (RNF-02)', 'Otra consulta responde 200 mientras la predicción está en curso',
    otra.status === 200 && (ESC !== 'motor-lento' || otra.ms < g.ms), `GET /api/products ${res(otra)} (predicción: ${g.ms} ms)`);
  const d = await pedir('GET', '/api/dashboard');
  caso(`${tag}-04`, 'El dashboard sigue disponible', '200 en ≤ 3 s', d.status === 200 && d.ms <= 3000, res(d));
  const s = await pedir('GET', '/api/status');
  // Con el motor lento el adaptador lo reinicia tras el corte, así que puede volver a figurar «listo»: se registra el estado
  caso(`${tag}-05`, 'El panel técnico informa el estado del motor', esperado === 'modelo' ? 'motor OK' : 'estado del motor visible para TI',
    s.status === 200 && (esperado === 'modelo' ? s.json?.motor?.estado === 'OK' : !!s.json?.motor?.estado),
    `motor ${s.json?.motor?.estado}, proceso ${s.json?.motor?.proceso}, versión ${s.json?.motor?.version_cargada}`);
}

async function escenarioBd() {
  if (!CONTENEDOR) throw new Error('Indica --contenedor-bd');
  const l = await pedir('POST', '/api/auth/login', QA);
  if (l.status !== 200) throw new Error(`login ${l.status}`);
  const prods = (await pedir('GET', '/api/products')).json?.data || [];
  const p = prods.find((x) => x.stock_actual >= 2) || prods[0];
  const stockAntes = p.stock_actual;
  const h0 = await pedir('GET', '/api/health');
  caso('F-BD-00', 'Línea base con la base disponible', 'health 200', h0.status === 200, res(h0));

  execSync(`docker stop ${CONTENEDOR}`, { stdio: 'ignore' });
  const caidaEn = Date.now();
  const h = await pedir('GET', '/api/health');
  caso('F-BD-01', 'Health check con la base detenida', '503 status DEGRADED, database ERROR', h.status === 503 && h.json?.database === 'ERROR', `${res(h)} ${h.texto}`);
  const d = await pedir('GET', '/api/dashboard');
  caso('F-BD-02', 'Dashboard con la base detenida', '503 bd_no_disponible con mensaje amigable, sin detalles técnicos',
    d.status === 503 && d.json?.error?.code === 'bd_no_disponible' && sinDetalle(d), `${res(d)} — «${d.json?.error?.message}»`);
  const v = await pedir('POST', '/api/sales', { id_producto: p.id_producto, cantidad: 1 });
  caso('F-BD-03', 'Registrar venta con la base detenida (CU-01 7b)', '503 amigable tras los reintentos, sin datos parciales',
    v.status === 503 && sinDetalle(v), `${res(v)} — «${v.json?.error?.message}»`);
  const lg = await pedir('POST', '/api/auth/login', QA);
  caso('F-BD-04', 'Iniciar sesión con la base detenida (CU-07 2a)', '503 amigable', lg.status === 503 && sinDetalle(lg), `${res(lg)} — «${lg.json?.error?.message}»`);

  execSync(`docker start ${CONTENEDOR}`, { stdio: 'ignore' });
  let vuelta = null;
  for (let i = 0; i < 60; i++) {
    const r = await pedir('GET', '/api/health');
    if (r.status === 200) {
      vuelta = Date.now();
      break;
    }
    await dormir(1000);
  }
  caso('F-BD-05', 'Recuperación automática al volver la base (sin reiniciar la API)', 'health 200 en menos de 60 s',
    !!vuelta, vuelta ? `${Math.round((vuelta - caidaEn) / 1000)} s desde la caída` : 'no se recuperó');
  await pedir('POST', '/api/auth/login', QA);
  const det = await pedir('GET', `/api/products/${p.id_producto}`);
  caso('F-BD-06', 'Atomicidad: la venta fallida no dejó datos parciales (RNF-11)', `stock sin cambios (${stockAntes})`,
    det.json?.data?.stock_actual === stockAntes, `stock ${det.json?.data?.stock_actual}`);
  const v2 = await pedir('POST', '/api/sales', { id_producto: p.id_producto, cantidad: 1 });
  caso('F-BD-07', 'Operación normal tras la recuperación', '201', v2.status === 201, res(v2));
}

(async () => {
  fs.mkdirSync(SALIDA, { recursive: true });
  console.log(`Escenario ${ESC} contra ${API}`);
  if (ESC === 'bd') await escenarioBd();
  else await escenarioMotor();
  const archivo = path.join(SALIDA, `fallas-${ESC}.json`);
  fs.writeFileSync(archivo, JSON.stringify({ fecha: new Date().toISOString(), api: API, escenario: ESC, resultados }, null, 2));
  process.exitCode = resultados.some((r) => r.resultado === 'Fallido') ? 1 : 0;
})().catch((e) => {
  console.error('Error en el escenario:', e.message);
  process.exit(1);
});
