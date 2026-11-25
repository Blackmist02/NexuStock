// Configuración leída de variables de entorno (ver «Maquinas virtuales/.env.example» en la raíz del repositorio). dotenv ya se carga en app.js.
const path = require('node:path');

const bool = (v, def) => (v === undefined || v === '' ? def : ['true', '1'].includes(String(v).toLowerCase()));
const int = (v, def) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : def);

function fechaReferencia(v) {
  if (!v) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    console.error(`Configuración inválida: FECHA_REFERENCIA debe tener el formato AAAA-MM-DD (recibido: ${v}).`);
    process.exit(1);
  }
  return v;
}

const isProd = process.env.NODE_ENV === 'production';
const DEV_SECRET = 'nexustock-dev-secret-cambiar-en-produccion';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProd) {
    console.error('Configuración inválida: JWT_SECRET es obligatorio en producción.');
    process.exit(1);
  }
  jwtSecret = DEV_SECRET;
  console.warn('[config] JWT_SECRET no definido: se usa un secreto de desarrollo. Defínelo en .env.');
}
if (isProd && jwtSecret.length < 32) {
  console.error('Configuración inválida: en producción JWT_SECRET debe tener al menos 32 caracteres.');
  process.exit(1);
}

module.exports = {
  isProd,
  port: int(process.env.PORT, 4000),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  // Orígenes del frontend permitidos (separados por coma). El frontend en desarrollo corre en 3000.
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
  // URL pública del frontend: se usa en el enlace de recuperación de contraseña
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  tz: process.env.TZ_NEGOCIO || 'America/Santiago',
  // La cookie de sesión solo viaja por HTTPS en producción (pon COOKIE_SECURE=false si pruebas por http)
  cookieSecure: bool(process.env.COOKIE_SECURE, isProd),
  // Saltos de proxy confiables delante de la API (el frontend de Next cuenta como 1)
  trustProxy: int(process.env.TRUST_PROXY, 1),
  authRateLimit: int(process.env.AUTH_RATE_LIMIT, 20),
  // IP real del cliente para el límite de intentos (lib/ipCliente.js). PROXY_SECRET debe ser el mismo en el frontend.
  proxySecret: process.env.PROXY_SECRET || '',
  trustCfConnectingIp: bool(process.env.TRUST_CF_CONNECTING_IP, false),
  // Cuentas nuevas desde «Crear cuenta»: la primera es administrador; las siguientes (operador) solo si está activo
  allowPublicSignup: bool(process.env.ALLOW_PUBLIC_SIGNUP, false),
  smtpUrl: process.env.SMTP_URL || '',
  mailFrom: process.env.MAIL_FROM || 'NexuStock <no-reply@nexustock.local>',
  demandaSemanasHistorial: int(process.env.DEMANDA_SEMANAS_HISTORIAL, 8),
  // Fecha fija que el sistema usa como «hoy» (AAAA-MM-DD). Solo para mostrar datos históricos: los datos deben estar
  // cargados hasta el día anterior (src ML/cargar_bd.py --hasta). Vacío = fecha del reloj.
  fechaReferencia: fechaReferencia(process.env.FECHA_REFERENCIA),
  // Carpeta para parámetros de la instalación (nombre del negocio, activación de alertas)
  dataDir: process.env.DATA_DIR || path.resolve(__dirname, '../data'),
  // Motor predictivo («src ML», Python; en Docker se monta como /ml-engine). Sin modelo activo o sin script, el sistema usa el respaldo (RF-11).
  ml: {
    dir: process.env.ML_ENGINE_DIR || path.resolve(__dirname, '../../src ML'),
    script: process.env.ML_PREDICT_SCRIPT || '',
    python: process.env.PYTHON_BIN || 'python3',
    timeoutMs: int(process.env.ML_TIMEOUT_MS, 2000),
    // Tope de una proyección «viable» (RNF-15): capacidad máxima del local en kg por semana
    capacidadKgSemana: int(process.env.CAPACIDAD_KG_SEMANA, 5000)
  },
  // Tareas periódicas: recalcular predicciones y alertas cada N minutos (0 = desactivado)
  evaluacionCadaMin: int(process.env.EVALUACION_CADA_MIN, 60)
};
