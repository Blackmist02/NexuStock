class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const unauthorized = (m = 'No autenticado') => new ApiError(401, 'no_autenticado', m);
const forbidden = (m = 'No tienes permiso para esta acción') => new ApiError(403, 'prohibido', m);

/** Valida con zod y lanza ApiError(400) con el detalle por campo. */
function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const details = r.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message }));
    throw new ApiError(400, 'validacion', 'Datos inválidos', details);
  }
  return r.data;
}

module.exports = { ApiError, unauthorized, forbidden, parse };
