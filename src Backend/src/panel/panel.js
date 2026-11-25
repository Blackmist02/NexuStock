/* Panel de la API de NexuStock: acceso de administrador/TI, estado de los servicios, consola y pruebas rápidas.
 * Usa la misma sesión (cookie httpOnly) y la cabecera CSRF que el frontend. Sin dependencias externas. */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const ROLES_PANEL = ['administrador', 'ti'];
  const ESCRITURA = ['POST', 'PUT', 'PATCH', 'DELETE'];

  /* ---------- Catálogo de endpoints (consola) ---------- */
  const CATALOGO = [
    ['Sistema', [
      ['GET', '/health', 'Healthcheck público: estado de la API y de la conexión a PostgreSQL (JSON).'],
      ['GET', '/status', 'Estado técnico detallado: API, base, motor ML y configuración (administrador o TI).']
    ]],
    ['Autenticación', [
      ['GET', '/auth/session', 'Sesión vigente (user: null si no hay sesión).'],
      ['GET', '/auth/me', 'Usuario autenticado.'],
      ['GET', '/auth/setup-status', 'Indica si ya existe la cuenta administradora inicial.'],
      ['POST', '/auth/logout', 'Cierra la sesión (borra la cookie). Tendrás que volver a ingresar.']
    ]],
    ['Dashboard', [
      ['GET', '/dashboard', 'Semáforo de stock, indicadores, demanda proyectada y sugerencias de la semana (CU-03, CU-09).']
    ]],
    ['Inventario', [
      ['GET', '/products', 'Productos con stock, umbrales y estado del semáforo (CU-04).'],
      ['GET', '/products/1', 'Detalle de un producto.'],
      ['GET', '/categories', 'Categorías del catálogo.'],
      ['GET', '/suppliers', 'Proveedores con lead time y días de atención.'],
      ['POST', '/categories', 'Crea una categoría (administrador).', { nombre: 'Categoría de prueba' }]
    ]],
    ['Movimientos', [
      ['GET', '/sales', 'Ventas registradas (paginadas).'],
      ['GET', '/purchases', 'Compras registradas (paginadas).'],
      ['POST', '/sales', 'Registra una venta y descuenta stock en una transacción (CU-01, RF-01).', { id_producto: 1, cantidad: 1.5 }],
      ['POST', '/purchases', 'Registra una compra y suma stock (CU-02, RF-02).', { id_producto: 1, cantidad: 10, costo_unitario_clp: 7000 }]
    ]],
    ['Alertas', [
      ['GET', '/alerts', 'Alertas activas de quiebre y stock bajo (CU-10).'],
      ['GET', '/alerts/recommendations', 'Sugerencias de compra: cuánto y hasta cuándo pedir (CU-09).'],
      ['POST', '/alerts/evaluate', 'Recalcula proyecciones y alertas en lote.'],
      ['PATCH', '/alerts/1', 'Atiende o descarta una alerta (RF-05).', { estado: 'atendida' }]
    ]],
    ['Predicción', [
      ['GET', '/predictions/resumen', 'Demanda proyectada de la semana por producto y su origen (modelo o respaldo).'],
      ['GET', '/predictions/producto/1/serie?atras=12&adelante=4', 'Serie de un producto: hasta 12 meses atrás y 4 adelante (CU-08).'],
      ['GET', '/predictions/serie?atras=3&adelante=1', 'Serie agregada de todos los productos.'],
      ['POST', '/predictions/generar', 'Genera y registra la predicción de un producto (RF-08, RF-10).', { id_producto: 1, horizonte: 'semana' }],
      ['GET', '/models', 'Modelos registrados, el activo y su precisión (CU-06).']
    ]],
    ['Reportes y calendario', [
      ['GET', '/history?tipo=todos', 'Historial de movimientos con totales del período.'],
      ['GET', '/events', 'Eventos del calendario (feriados, Fiestas Patrias, días de pago).']
    ]],
    ['Administración', [
      ['GET', '/users', 'Usuarios y roles (RF-12).'],
      ['GET', '/config', 'Configuración del negocio y fecha del sistema.'],
      ['PUT', '/config/fecha', 'Cambia la fecha del sistema y recalcula proyecciones y alertas.', { fecha: '2024-09-29' }]
    ]]
  ];

  /* ---------- Pruebas rápidas (solo lectura) ---------- */
  const PRUEBAS = [
    ['Servicios', [
      { nombre: 'Healthcheck', metodo: 'GET', ruta: '/health', esperado: 200, revisar: (j) => j && j.status === 'OK' && j.database === 'OK' },
      { nombre: 'Estado técnico', metodo: 'GET', ruta: '/status', esperado: 200 },
      { nombre: 'Sesión vigente', metodo: 'GET', ruta: '/auth/session', esperado: 200, revisar: (j) => !!(j && j.user) },
      { nombre: 'Dashboard', metodo: 'GET', ruta: '/dashboard', esperado: 200 },
      { nombre: 'Productos', metodo: 'GET', ruta: '/products', esperado: 200 },
      { nombre: 'Proveedores', metodo: 'GET', ruta: '/suppliers', esperado: 200 },
      { nombre: 'Alertas', metodo: 'GET', ruta: '/alerts', esperado: 200 },
      { nombre: 'Sugerencias de compra', metodo: 'GET', ruta: '/alerts/recommendations', esperado: 200 },
      { nombre: 'Predicción de la semana', metodo: 'GET', ruta: '/predictions/resumen', esperado: 200 },
      { nombre: 'Modelos', metodo: 'GET', ruta: '/models', esperado: 200 },
      { nombre: 'Historial', metodo: 'GET', ruta: '/history?tipo=todos', esperado: 200 },
      { nombre: 'Configuración', metodo: 'GET', ruta: '/config', esperado: 200 }
    ]],
    ['Seguridad', [
      { nombre: 'Sin sesión no hay datos', metodo: 'GET', ruta: '/dashboard', esperado: 401, sinSesion: true },
      { nombre: 'Escritura sin cabecera CSRF', metodo: 'POST', ruta: '/sales', esperado: 403, sinSesion: true, sinCsrf: true, cuerpo: {} },
      { nombre: 'Login con credenciales inválidas', metodo: 'POST', ruta: '/auth/login', esperado: 401, sinSesion: true,
        cuerpo: { email: 'prueba-panel@nexustock.invalid', password: 'incorrecta' } },
      { nombre: 'Ruta inexistente', metodo: 'GET', ruta: '/no-existe', esperado: 404 }
    ]]
  ];

  /* ---------- Utilidades ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('es-CL');
  const fechaHora = (iso) => new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'medium' });

  function duracion(seg) {
    const d = Math.floor(seg / 86400), h = Math.floor((seg % 86400) / 3600), m = Math.floor((seg % 3600) / 60);
    if (d) return `${d} d ${h} h`;
    if (h) return `${h} h ${m} min`;
    return `${m} min ${seg % 60} s`;
  }

  function resaltar(json) {
    return esc(json).replace(
      /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (m) => {
        let c = 'j-num';
        if (/^"/.test(m)) c = /:$/.test(m) ? 'j-key' : 'j-str';
        else if (/true|false|null/.test(m)) c = 'j-lit';
        return `<span class="${c}">${m}</span>`;
      }
    );
  }

  let avisoT;
  function aviso(texto) {
    const el = $('#aviso');
    el.textContent = texto;
    el.hidden = false;
    clearTimeout(avisoT);
    avisoT = setTimeout(() => { el.hidden = true; }, 2200);
  }

  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      aviso('Copiado al portapapeles');
    } catch {
      aviso('No se pudo copiar');
    }
  }

  /** Llamada a la API. Devuelve { status, ms, json, texto, bytes }. */
  async function api(metodo, ruta, { cuerpo, sinSesion = false, sinCsrf = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (!sinCsrf) headers['x-nx-csrf'] = '1';
    if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
    const t0 = performance.now();
    const res = await fetch(`/api${ruta}`, {
      method: metodo,
      headers,
      credentials: sinSesion ? 'omit' : 'same-origin',
      cache: 'no-store',
      body: cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)
    });
    const texto = await res.text();
    const ms = Math.round(performance.now() - t0);
    let json;
    try { json = texto ? JSON.parse(texto) : undefined; } catch { json = undefined; }
    return { status: res.status, ms, json, texto, bytes: new Blob([texto]).size };
  }

  /* ---------- Tema ---------- */
  const raiz = document.documentElement;
  try {
    const t = localStorage.getItem('nx-panel-tema');
    if (t === 'light' || t === 'dark') raiz.dataset.theme = t;
  } catch { /* sin almacenamiento */ }
  function alternarTema() {
    const oscuro = raiz.dataset.theme ? raiz.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    raiz.dataset.theme = oscuro ? 'light' : 'dark';
    try { localStorage.setItem('nx-panel-tema', raiz.dataset.theme); } catch { /* sin almacenamiento */ }
  }

  /* ---------- Acceso ---------- */
  function mostrarAcceso(mensaje) {
    detenerRefresco();
    $('#vista-panel').hidden = true;
    $('#vista-acceso').hidden = false;
    const err = $('#error-acceso');
    err.hidden = !mensaje;
    err.textContent = mensaje || '';
    setTimeout(() => $('#email').focus(), 0);
  }

  function mostrarPanel(u) {
    $('#vista-acceso').hidden = true;
    $('#vista-panel').hidden = false;
    $('#usuario').innerHTML = `<b>${esc(u.nombre)}</b> · ${u.rol === 'ti' ? 'Administrador TI' : 'Administrador'}`;
    cargarEstado();
    iniciarRefresco();
  }

  async function verificarSesion() {
    try {
      const r = await api('GET', '/auth/session');
      const u = r.json && r.json.user;
      if (!u) return mostrarAcceso();
      if (!ROLES_PANEL.includes(u.rol)) return mostrarAcceso('Tu cuenta no tiene acceso al panel de la API: se requiere el rol administrador o TI.');
      mostrarPanel(u);
    } catch {
      mostrarAcceso('No se pudo contactar a la API. Revisa tu conexión e intenta de nuevo.');
    }
  }

  async function ingresar(e) {
    e.preventDefault();
    const email = $('#email').value.trim();
    const password = $('#password').value;
    if (!email || !password) return mostrarAcceso('Ingresa tu correo y contraseña.');
    const btn = $('#btn-entrar');
    btn.disabled = true;
    btn.textContent = 'Ingresando…';
    try {
      const r = await api('POST', '/auth/login', { cuerpo: { email, password } });
      if (r.status === 429) return mostrarAcceso('Demasiados intentos. Espera unos minutos antes de volver a intentar.');
      if (r.status !== 200) return mostrarAcceso((r.json && r.json.error && r.json.error.message) || 'No se pudo iniciar sesión.');
      const u = r.json.user;
      if (!ROLES_PANEL.includes(u.rol)) {
        await api('POST', '/auth/logout');
        return mostrarAcceso('Tu cuenta no tiene acceso al panel de la API: se requiere el rol administrador o TI.');
      }
      $('#password').value = '';
      mostrarPanel(u);
    } catch {
      mostrarAcceso('No se pudo contactar a la API. Revisa tu conexión e intenta de nuevo.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    }
  }

  async function salir() {
    try { await api('POST', '/auth/logout'); } catch { /* la cookie se ignora igual */ }
    mostrarAcceso();
  }

  /* ---------- Estado ---------- */
  let refresco;
  const iniciarRefresco = () => {
    detenerRefresco();
    if ($('#auto-refresco').checked) refresco = setInterval(() => { if (!document.hidden) cargarEstado(true); }, 30000);
  };
  const detenerRefresco = () => clearInterval(refresco);

  const sino = (v) => (v ? '<span class="si">sí</span>' : '<span class="no">no</span>');
  const nivel = (estado) => (estado === 'OK' ? 'ok' : estado === 'RESPALDO' || estado === 'DEGRADADO' ? 'warn' : 'err');
  const etiqueta = { OK: 'Operativo', RESPALDO: 'Respaldo RF-11', DEGRADADO: 'Degradado', ERROR: 'Con error' };

  function tarjeta(titulo, estado, principal, filas) {
    const n = nivel(estado);
    return `<article class="tarjeta ${n}">
      <div class="tarjeta-cab"><h3>${esc(titulo)}</h3><span class="chip ${n}">${etiqueta[estado] || esc(estado)}</span></div>
      <div class="principal">${principal}</div>
      <dl class="datos">${filas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
    </article>`;
  }

  async function cargarEstado(silencioso) {
    const btn = $('#btn-actualizar');
    btn.disabled = true;
    if (!silencioso && !$('#tarjetas').children.length) {
      $('#tarjetas').innerHTML = '<div class="esqueleto"></div>'.repeat(4);
    }
    try {
      const r = await api('GET', '/status');
      if (r.status === 401) return mostrarAcceso('Tu sesión expiró. Vuelve a ingresar.');
      if (r.status === 403) return mostrarAcceso('Tu cuenta no tiene acceso al panel de la API.');
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      pintarEstado(r.json, r.ms);
    } catch (e) {
      $('#chip-global').className = 'chip err';
      $('#chip-global').textContent = 'Sin respuesta';
      $('#estado-actualizado').textContent = `No se pudo obtener el estado (${e.message}). Se reintentará automáticamente.`;
    } finally {
      btn.disabled = false;
    }
  }

  function pintarEstado(s, ms) {
    const global = $('#chip-global');
    const todoOk = s.estado === 'OK' && s.motor.estado === 'OK';
    global.className = `chip ${todoOk ? 'ok' : nivel(s.estado === 'OK' ? 'RESPALDO' : s.estado)}`;
    global.textContent = todoOk ? 'Todos los servicios operativos' : s.estado === 'OK' ? 'Operativo con respaldo' : 'Servicio degradado';
    $('#meta-entorno').textContent = [s.api.entorno, s.api.commit && `commit ${s.api.commit}`, `v${s.api.version}`].filter(Boolean).join(' · ');
    $('#estado-actualizado').textContent = `Actualizado ${fechaHora(s.generado)} · respuesta en ${ms} ms`;

    const m = s.motor.modelo;
    const fecha = s.configuracion.fecha_referencia;
    $('#tarjetas').innerHTML = [
      tarjeta('API REST', s.api.estado, `Express<small>Node ${esc(s.api.node)}</small>`, [
        ['En línea hace', esc(duracion(s.api.uptime_s))],
        ['Memoria', `${nf.format(s.api.memoria_mb)} MB`],
        ['Entorno', esc(s.api.entorno)],
        ['Versión', esc(s.api.commit ? `${s.api.version} (${s.api.commit})` : s.api.version)]
      ]),
      tarjeta('Base de datos', s.base.estado, `${s.base.latencia_ms} ms<small>latencia</small>`, [
        ['Motor', esc(s.base.version || '—')],
        ['Productos', s.base.tablas ? nf.format(s.base.tablas.productos) : '—'],
        ['Ventas', s.base.tablas ? nf.format(s.base.tablas.ventas) : '—'],
        ['Alertas activas', s.base.tablas ? nf.format(s.base.tablas.alertas_activas) : '—']
      ]),
      tarjeta('Motor predictivo', s.motor.estado, m ? `${esc(m.algoritmo === 'RandomForestRegressor' ? 'Random Forest' : m.algoritmo)}<small>v${esc(m.version)}</small>` : 'Sin modelo', [
        ['Proceso predict.py', s.motor.proceso === 'listo' ? '<span class="si">listo</span>' : `<span class="no">${esc(s.motor.proceso)}</span>`],
        ['MAE general', m ? `${String(m.mae_general).replace('.', ',')} kg` : '—'],
        ['MAE festivos', m ? `${String(m.mae_festivos).replace('.', ',')} kg` : '—'],
        ['Artefacto presente', m ? sino(m.artefacto_presente) : '—']
      ]),
      tarjeta('Fecha del sistema', 'OK', fecha ? esc(fecha.split('-').reverse().join('-')) : 'Fecha real', [
        ['Origen', esc(s.configuracion.origen_fecha || 'reloj')],
        ['Negocio', esc(s.configuracion.negocio || '—')],
        ['Zona horaria', esc(s.configuracion.zona_horaria)],
        ['Recalcular alertas', s.configuracion.evaluacion_cada_min ? `cada ${s.configuracion.evaluacion_cada_min} min` : 'manual']
      ])
    ].join('');

    const t = s.base.tablas || {};
    const etiquetas = [['productos', 'Productos'], ['proveedores', 'Proveedores'], ['ventas', 'Ventas'], ['compras', 'Compras'],
      ['mermas', 'Mermas'], ['predicciones', 'Predicciones'], ['alertas_activas', 'Alertas activas'], ['usuarios_activos', 'Usuarios activos']];
    $('#cifras').innerHTML = etiquetas.map(([k, l]) => `<div class="cifra"><b>${t[k] == null ? '—' : nf.format(t[k])}</b><span>${l}</span></div>`).join('');

    const c = s.configuracion;
    const filas = [
      ['Orígenes CORS permitidos', c.origenes_cors.map(esc).join('<br>') || '—'],
      ['Cookie solo por HTTPS', sino(c.cookie_segura)],
      ['Proxies confiables', esc(c.proxies_confiables)],
      ['Intentos de login (15 min)', esc(c.limite_intentos_login)],
      ['Tiempo máximo del motor', `${nf.format(c.timeout_motor_ms)} ms`],
      ['Correo (SMTP) configurado', sino(c.correo_configurado)],
      ['Registro público de cuentas', sino(c.registro_publico)],
      ['Servicio', esc(s.api.servicio || '—')],
      ['Sesión', `${esc(s.usuario.nombre)} (${esc(s.usuario.rol)})`]
    ];
    $('#config').innerHTML = filas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');
  }

  /* ---------- Consola ---------- */
  let seleccionado = null;
  let ultima = null;

  function pintarCatalogo(filtro = '') {
    const f = filtro.trim().toLowerCase();
    $('#lista-endpoints').innerHTML = CATALOGO.map(([grupo, eps]) => {
      const visibles = eps.filter(([m, r, d]) => !f || `${m} ${r} ${d} ${grupo}`.toLowerCase().includes(f));
      if (!visibles.length) return '';
      return `<div class="grupo"><h4>${esc(grupo)}</h4>${visibles.map(([m, r]) => {
        const id = `${m} ${r}`;
        return `<button type="button" class="endpoint${seleccionado === id ? ' activo' : ''}" data-id="${esc(id)}" title="${esc(id)}">
          <span class="metodo m-${m}">${m}</span><span class="ruta-txt">${esc(r)}</span></button>`;
      }).join('')}</div>`;
    }).join('') || '<p class="muted">Sin resultados.</p>';
  }

  function buscarEndpoint(id) {
    for (const [, eps] of CATALOGO) for (const ep of eps) if (`${ep[0]} ${ep[1]}` === id) return ep;
    return null;
  }

  function elegir(id) {
    const ep = buscarEndpoint(id);
    if (!ep) return;
    const [m, r, d, cuerpo] = ep;
    seleccionado = id;
    $('#metodo').value = m;
    $('#ruta').value = r;
    $('#descripcion').textContent = d;
    $('#cuerpo').value = cuerpo ? JSON.stringify(cuerpo, null, 2) : '';
    actualizarCuerpo();
    pintarCatalogo($('#buscar').value);
  }

  const actualizarCuerpo = () => { $('#cuerpo-wrap').hidden = !ESCRITURA.includes($('#metodo').value); };

  function confirmar(texto) {
    const d = $('#confirmar');
    $('#confirmar-texto').textContent = texto;
    return new Promise((ok) => {
      d.addEventListener('close', () => ok(d.returnValue === 'si'), { once: true });
      d.showModal();
    });
  }

  async function enviar() {
    const metodo = $('#metodo').value;
    let ruta = $('#ruta').value.trim();
    if (!ruta.startsWith('/')) ruta = `/${ruta}`;
    let cuerpo;
    if (ESCRITURA.includes(metodo)) {
      const txt = $('#cuerpo').value.trim();
      if (txt) {
        try { cuerpo = JSON.parse(txt); } catch { return aviso('El cuerpo no es un JSON válido'); }
      }
      const cierre = ruta.startsWith('/auth/logout');
      const ok = await confirmar(cierre
        ? 'Cerrar la sesión te devolverá a la pantalla de acceso.'
        : `${metodo} /api${ruta} escribe en la base de datos de la demo. Úsalo solo si sabes qué cambiará.`);
      if (!ok) return;
    }
    const btn = $('#btn-enviar');
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    $('#resp-estado').className = 'chip';
    $('#resp-estado').textContent = 'Esperando…';
    try {
      const r = await api(metodo, ruta, { cuerpo });
      ultima = { metodo, ruta, cuerpo, r };
      const n = r.status < 300 ? 'ok' : r.status < 500 ? 'warn' : 'err';
      $('#resp-estado').className = `chip ${n}`;
      $('#resp-estado').textContent = `${r.status}`;
      $('#resp-meta').textContent = `${r.ms} ms · ${nf.format(r.bytes)} bytes`;
      $('#resp-cuerpo').innerHTML = r.json !== undefined ? resaltar(JSON.stringify(r.json, null, 2)) : esc(r.texto || '(sin contenido)');
      if (ruta.startsWith('/auth/logout') && r.status < 300) mostrarAcceso();
    } catch (e) {
      $('#resp-estado').className = 'chip err';
      $('#resp-estado').textContent = 'Error de red';
      $('#resp-meta').textContent = '';
      $('#resp-cuerpo').textContent = String(e.message || e);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar';
    }
  }

  function comoCurl() {
    const metodo = $('#metodo').value;
    let ruta = $('#ruta').value.trim();
    if (!ruta.startsWith('/')) ruta = `/${ruta}`;
    const partes = [`curl -i -X ${metodo} "${location.origin}/api${ruta}"`];
    if (ESCRITURA.includes(metodo)) {
      partes.push('-H "x-nx-csrf: 1"');
      const txt = $('#cuerpo').value.trim();
      if (txt) partes.push('-H "Content-Type: application/json"', `-d '${txt.replace(/\s+/g, ' ').replace(/'/g, "'\\''")}'`);
    }
    if (!ruta.startsWith('/health')) partes.push('-H "Authorization: Bearer <token>"');
    copiar(partes.join(' \\\n  '));
  }

  /* ---------- Pruebas rápidas ---------- */
  function filaPrueba(p, i) {
    return `<tr id="prueba-${i}">
      <td>${esc(p.nombre)}</td>
      <td class="mono"><span class="metodo m-${p.metodo}">${p.metodo}</span> /api${esc(p.ruta)}</td>
      <td class="mono">${p.esperado}</td><td class="mono" data-c="obtenido">—</td><td class="mono" data-c="tiempo">—</td>
      <td data-c="resultado"><span class="chip">Pendiente</span></td></tr>`;
  }

  function pintarPruebas() {
    let i = 0;
    $('#tabla-pruebas').innerHTML = PRUEBAS.map(([g, ps]) =>
      `<tr class="grupo-fila"><td colspan="6">${esc(g)}</td></tr>${ps.map((p) => filaPrueba(p, i++)).join('')}`).join('');
  }

  async function ejecutarPruebas() {
    pintarPruebas();
    const btn = $('#btn-pruebas');
    btn.disabled = true;
    const todas = PRUEBAS.flatMap(([, ps]) => ps);
    let aprobadas = 0;
    const resumen = $('#resumen-pruebas');
    resumen.className = 'chip';
    for (let i = 0; i < todas.length; i++) {
      const p = todas[i];
      const fila = $(`#prueba-${i}`);
      const celda = (c) => fila.querySelector(`[data-c="${c}"]`);
      celda('resultado').innerHTML = '<span class="chip">Ejecutando…</span>';
      resumen.textContent = `Ejecutando ${i + 1} de ${todas.length}…`;
      try {
        const r = await api(p.metodo, p.ruta, { cuerpo: p.cuerpo, sinSesion: p.sinSesion, sinCsrf: p.sinCsrf });
        const ok = r.status === p.esperado && (!p.revisar || p.revisar(r.json));
        if (ok) aprobadas++;
        celda('obtenido').textContent = r.status;
        celda('tiempo').textContent = `${r.ms} ms`;
        celda('resultado').innerHTML = ok ? '<span class="chip ok">Aprobada</span>' : '<span class="chip err">Falló</span>';
      } catch {
        celda('obtenido').textContent = 'red';
        celda('resultado').innerHTML = '<span class="chip err">Sin respuesta</span>';
      }
    }
    resumen.className = `chip ${aprobadas === todas.length ? 'ok' : 'err'}`;
    resumen.textContent = `${aprobadas} de ${todas.length} aprobadas`;
    btn.disabled = false;
    btn.textContent = 'Ejecutar de nuevo';
  }

  /* ---------- Navegación ---------- */
  function irA(vista) {
    document.querySelectorAll('.pestana').forEach((b) => {
      const activa = b.dataset.vista === vista;
      b.classList.toggle('activa', activa);
      b.setAttribute('aria-selected', String(activa));
    });
    ['estado', 'consola', 'pruebas'].forEach((v) => { $(`#vista-${v}`).hidden = v !== vista; });
    if (vista === 'estado') cargarEstado(true);
  }

  /* ---------- Inicio ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    $('#form-acceso').addEventListener('submit', ingresar);
    $('#ver-pass').addEventListener('click', () => {
      const p = $('#password');
      const ver = p.type === 'password';
      p.type = ver ? 'text' : 'password';
      $('#ver-pass').textContent = ver ? 'Ocultar' : 'Ver';
    });
    $('#btn-salir').addEventListener('click', salir);
    $('#btn-tema').addEventListener('click', alternarTema);
    $('#btn-actualizar').addEventListener('click', () => cargarEstado());
    $('#auto-refresco').addEventListener('change', iniciarRefresco);
    document.querySelectorAll('.pestana').forEach((b) => b.addEventListener('click', () => irA(b.dataset.vista)));

    pintarCatalogo();
    $('#buscar').addEventListener('input', (e) => pintarCatalogo(e.target.value));
    $('#lista-endpoints').addEventListener('click', (e) => {
      const b = e.target.closest('.endpoint');
      if (b) elegir(b.dataset.id);
    });
    $('#metodo').addEventListener('change', actualizarCuerpo);
    $('#btn-enviar').addEventListener('click', enviar);
    $('#ruta').addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });
    $('#btn-copiar').addEventListener('click', () => (ultima ? copiar(ultima.r.texto) : aviso('Aún no hay respuesta')));
    $('#btn-curl').addEventListener('click', comoCurl);

    pintarPruebas();
    $('#btn-pruebas').addEventListener('click', ejecutarPruebas);

    elegir('GET /health');
    verificarSesion();
  });
})();
