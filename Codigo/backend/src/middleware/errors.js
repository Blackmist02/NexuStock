const config = require('../config');
const { ApiError } = require('../lib/errors');

function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'ruta_no_encontrada', message: 'Ruta no encontrada' } });
}

// Express 5 envía aquí también los errores de handlers async
function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err && err.code === '23505') {
    return res.status(409).json({ error: { code: 'duplicado', message: 'Ya existe un registro con esos datos' } });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'json_invalido', message: 'El cuerpo no es JSON válido' } });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'demasiado_grande', message: 'El cuerpo excede el tamaño permitido' } });
  }
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({
    error: { code: 'error_interno', message: config.isProd ? 'Error interno del servidor' : (err && err.message) || 'Error interno' }
  });
}

module.exports = { notFoundHandler, errorHandler };
