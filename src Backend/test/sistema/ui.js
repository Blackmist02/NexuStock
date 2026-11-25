/* global window, document */ // se usan dentro de page.evaluate (contexto del navegador)
// Prueba de sistema en el navegador (tarea 28): login, dashboard, pérdida y recuperación de conexión (RNF-16, CU-03 7c),
// en escritorio y móvil, con el Edge o Chrome instalado. Requiere playwright-core (no es dependencia del proyecto):
//   npm i --no-save playwright-core && QA_EMAIL=... QA_PASSWORD=... node test/sistema/ui.js [--front URL] [--salida carpeta]
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const arg = (n, def) => (process.argv.indexOf(`--${n}`) > 0 ? process.argv[process.argv.indexOf(`--${n}`) + 1] : def);
const FRONT = arg('front', 'https://nexustock-omega.vercel.app');
const SALIDA = arg('salida', path.join(__dirname, 'resultados'));
const OUT = path.join(SALIDA, 'capturas');
fs.mkdirSync(OUT, { recursive: true });
const cred = { email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD };
const res = [];
const caso = (id, d, ok, obt) => { res.push({ id, descripcion: d, resultado: ok ? 'Aprobado' : 'Fallido', obtenido: obt }); console.log(`${ok ? '✔' : '✘'} ${id} ${d} — ${obt}`); };

// El dashboard está listo cuando su contenido principal está renderizado (no hay esqueleto de carga)
const listo = (page) => page.waitForFunction(() => {
  const m = document.querySelector('main');
  return m && m.innerText.length > 1500 && !document.querySelector('[aria-busy="true"]');
}, null, { timeout: 25000 });

(async () => {
  const browser = await chromium.launch({ channel: process.env.NAVEGADOR || 'msedge', headless: true });
  for (const [nombre, viewport] of [['escritorio', { width: 1366, height: 800 }], ['movil', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport, locale: 'es-CL' });
    const page = await ctx.newPage();
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));
    await page.goto(`${FRONT}/dashboard`, { waitUntil: 'domcontentloaded' });
    caso(`UI-${nombre}-01`, `Sin sesión, /dashboard redirige a /login (${nombre})`, page.url().includes('/login'), page.url());
    await page.fill('input[type=email]', cred.email);
    await page.fill('input[type=password]', cred.password);
    const t0 = Date.now();
    await page.click('button[type=submit]');
    await page.waitForURL(/\/dashboard/, { timeout: 20000 });
    await listo(page);
    const tCarga = Date.now() - t0;
    await page.screenshot({ path: path.join(OUT, `${nombre}-1-dashboard.png`), fullPage: nombre === 'escritorio' });
    caso(`UI-${nombre}-02`, `Login y carga completa del dashboard en el navegador (${nombre})`, tCarga <= 3000 + 2500, `${tCarga} ms (incluye login con bcrypt)`);
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    caso(`UI-${nombre}-03`, `Sin desplazamiento horizontal (RNF-24) (${nombre})`, ancho <= 1, `exceso ${ancho} px`);
    const textoAntes = (await page.textContent('main').catch(() => '')) || '';

    // Recarga del dashboard ya con sesión: tiempo de carga percibido
    const recargas = [];
    for (let i = 0; i < 3; i++) {
      const t1 = Date.now();
      await page.reload({ waitUntil: 'commit' });
      await listo(page);
      recargas.push(Date.now() - t1);
    }
    const med = [...recargas].sort((x, y) => x - y)[1];
    caso(`UI-${nombre}-04`, `Recarga del dashboard con sesión hasta ver los datos ≤ 3 s (CU-03) (${nombre})`, med <= 3000, `mediana ${med} ms (${recargas.join(', ')} ms)`);

    // Pérdida de conexión
    await ctx.setOffline(true);
    const aviso = page.locator('.net-aviso').first();
    await aviso.waitFor({ timeout: 35000 }).catch(() => {});
    const txtAviso = (await aviso.textContent().catch(() => '')) || '';
    await page.screenshot({ path: path.join(OUT, `${nombre}-2-sin-conexion.png`), fullPage: false });
    caso(`UI-${nombre}-05`, `Aviso amigable al perder la conexión (RNF-16) (${nombre})`, /sin conexión|comunicarnos/i.test(txtAviso), txtAviso.trim().slice(0, 140));
    const textoDurante = (await page.textContent('main').catch(() => '')) || '';
    caso(`UI-${nombre}-06`, `El dashboard sigue visible con la última información (${nombre})`, textoDurante.length > 200 && textoDurante.length >= textoAntes.length * 0.5, `${textoDurante.length} caracteres visibles (antes ${textoAntes.length})`);

    // Recuperación
    await ctx.setOffline(false);
    const ok = page.locator('.net-aviso.ok').first();
    await ok.waitFor({ timeout: 40000 }).catch(() => {});
    const txtOk = (await ok.textContent().catch(() => '')) || '';
    await page.screenshot({ path: path.join(OUT, `${nombre}-3-reconectado.png`), fullPage: false });
    caso(`UI-${nombre}-07`, `Se actualiza solo al reconectar (${nombre})`, /restablecida/i.test(txtOk), txtOk.trim().slice(0, 120));

    // Datos locales: sin credenciales
    const ls = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
    const lsTxt = JSON.stringify(ls);
    caso(`UI-${nombre}-08`, `La copia local no guarda credenciales ni el token (${nombre})`, !/nx_token|password|eyJhbGci/i.test(lsTxt), `${Object.keys(ls).length} claves: ${Object.keys(ls).join(', ').slice(0, 160)}`);
    const cookies = await ctx.cookies();
    const c = cookies.find((x) => x.name === 'nx_token');
    caso(`UI-${nombre}-09`, `Cookie de sesión inaccesible para JavaScript (${nombre})`, c && c.httpOnly && c.secure && (await page.evaluate(() => !document.cookie.includes('nx_token'))), c ? `httpOnly=${c.httpOnly}, secure=${c.secure}, sameSite=${c.sameSite}` : 'sin cookie');

    // Cerrar sesión borra los datos locales
    const boton = page.getByRole('button', { name: /cerrar sesión/i }).first();
    let porUi = false;
    if (!(await boton.isVisible().catch(() => false))) { await page.getByRole('button', { name: 'Mostrar menú' }).first().click().catch(() => {}); await boton.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {}); }
    if (await boton.isVisible().catch(() => false)) {
      await boton.click();
      await page.getByRole('button', { name: /^cerrar sesión$/i }).last().click({ timeout: 3000 }).catch(() => {});
      await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});
      porUi = true;
    } else {
      await page.request.post(`${FRONT}/api/auth/logout`, { headers: { 'x-nx-csrf': '1' } });
    }
    const quedan = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('nx:')));
    caso(`UI-${nombre}-12`, `Cerrar sesión borra los datos guardados localmente (CU-07) (${nombre})`, porUi && quedan.length === 0, `${porUi ? 'botón de la UI' : 'botón no encontrado (API)'}; claves restantes: ${quedan.join(', ') || 'ninguna'}`);
    await page.goto(`${FRONT}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});
    caso(`UI-${nombre}-10`, `Tras cerrar sesión, el dashboard vuelve a pedir inicio de sesión (${nombre})`, page.url().includes('/login'), page.url());
    caso(`UI-${nombre}-11`, `Sin errores de JavaScript en la página (${nombre})`, errores.length === 0, errores.join(' | ').slice(0, 200) || 'ninguno');
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(SALIDA, 'ui.json'), JSON.stringify({ fecha: new Date().toISOString(), resultados: res }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
