// Configuración leída de variables de entorno (ver ../.env.example). dotenv ya se carga en app.js.
const bool = (v, def) => (v === undefined || v === '' ? def : ['true', '1'].includes(String(v).toLowerCase()));
const int = (v, def) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : def);

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
  // Orígenes del frontend permitidos (separados por coma). El frontend en desarrollo corre en 3001 (el 3000 lo usa otro proyecto).
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:3001').split(',').map((s) => s.trim()).filter(Boolean),
  // URL pública del frontend: se usa en el enlace de recuperación de contraseña
  appUrl: (process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, ''),
  tz: process.env.TZ_NEGOCIO || 'America/Santiago',
  // La cookie de sesión solo viaja por HTTPS en producción (pon COOKIE_SECURE=false si pruebas por http)
  cookieSecure: bool(process.env.COOKIE_SECURE, isProd),
  // Saltos de proxy confiables delante de la API (el frontend de Next cuenta como 1)
  trustProxy: int(process.env.TRUST_PROXY, 1),
  authRateLimit: int(process.env.AUTH_RATE_LIMIT, 20),
  // Cuentas nuevas desde «Crear cuenta»: la primera es administrador; las siguientes (operador) solo si está activo
  allowPublicSignup: bool(process.env.ALLOW_PUBLIC_SIGNUP, false),
  smtpUrl: process.env.SMTP_URL || '',
  mailFrom: process.env.MAIL_FROM || 'NexuStock <no-reply@nexustock.local>',
  demandaSemanasHistorial: int(process.env.DEMANDA_SEMANAS_HISTORIAL, 8)
};
