/**
 * Parámetros de la instalación (una instalación por carnicería), guardados en la tabla CONFIGURACION (modelo v5):
 *  - negocio:          { nombre, alertas: { quiebre, bajo } }
 *  - fecha_referencia: { fecha: AAAA-MM-DD | null }  («hoy» del sistema; null = fecha real)
 * Se mantienen en memoria: `leer()` es síncrono y `cargar()` los trae de la base al iniciar. Si la base aún no tiene
 * la tabla (modelo v4, sin migracion_v5.sql), se usa el archivo data/negocio.json como antes; al migrar, ese archivo
 * se copia a la tabla la primera vez.
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const db = require('../db');
const fechaSistema = require('./fechaSistema');

const ARCHIVO = path.join(config.dataDir, 'negocio.json');
const POR_DEFECTO = { nombre: 'Mi carnicería', alertas: { quiebre: true, bajo: true } };

let cache = null;

const normalizar = (raw) => ({
  nombre: raw && typeof raw.nombre === 'string' && raw.nombre.trim() ? raw.nombre.trim() : POR_DEFECTO.nombre,
  alertas: { ...POR_DEFECTO.alertas, ...((raw && raw.alertas) || {}) }
});

function leerArchivo() {
  try {
    return normalizar(JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')));
  } catch {
    return null;
  }
}

function escribirArchivo(valor) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${ARCHIVO}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(valor, null, 2));
  fs.renameSync(tmp, ARCHIVO);
}

const sinTabla = (e) => e && e.code === '42P01'; // relation does not exist

async function upsert(clave, valor, idUsuario = null, client = db) {
  await client.query(
    `INSERT INTO configuracion (clave, valor, id_usuario, actualizado_en) VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, id_usuario = EXCLUDED.id_usuario, actualizado_en = NOW()`,
    [clave, JSON.stringify(valor), idUsuario]
  );
}

/** Datos del negocio vigentes (síncrono; antes de `cargar()` usa el archivo o los valores por defecto). */
function leer() {
  if (!cache) cache = leerArchivo() || structuredClone(POR_DEFECTO);
  return cache;
}

/**
 * Lee CONFIGURACION al iniciar el servidor. Devuelve true si la tabla existe. La fecha guardada reemplaza a
 * FECHA_REFERENCIA; si nunca se guardó una, se mantiene la del entorno.
 */
async function cargar() {
  try {
    const { rows } = await db.query('SELECT clave, valor FROM configuracion');
    const porClave = new Map(rows.map((r) => [r.clave, r.valor]));
    if (porClave.has('negocio')) cache = normalizar(porClave.get('negocio'));
    else {
      cache = leerArchivo() || structuredClone(POR_DEFECTO);
      await upsert('negocio', cache); // migra data/negocio.json a la base
    }
    if (porClave.has('fecha_referencia')) fechaSistema.fijar(porClave.get('fecha_referencia').fecha, 'base');
    return true;
  } catch (e) {
    if (sinTabla(e)) {
      console.warn('[configuración] la base no tiene la tabla CONFIGURACION (aplica migracion_v5.sql): se usa data/negocio.json');
      leer();
      return false;
    }
    throw e;
  }
}

/** Guarda nombre y/o alertas del negocio. */
async function guardar(parcial, idUsuario = null) {
  const actual = leer();
  const nuevo = {
    nombre: parcial.nombre !== undefined ? String(parcial.nombre).trim() : actual.nombre,
    alertas: { ...actual.alertas, ...(parcial.alertas || {}) }
  };
  try {
    await upsert('negocio', nuevo, idUsuario);
  } catch (e) {
    if (!sinTabla(e)) throw e;
    escribirArchivo(nuevo);
  }
  cache = nuevo;
  return nuevo;
}

/** Guarda la fecha de referencia (AAAA-MM-DD) o null para volver a la fecha real. Requiere la tabla CONFIGURACION. */
async function guardarFechaReferencia(fecha, idUsuario = null) {
  await upsert('fecha_referencia', { fecha: fecha || null }, idUsuario);
  fechaSistema.fijar(fecha, 'base');
}

/** Solo para pruebas. */
const reiniciarCache = () => {
  cache = null;
};

module.exports = { leer, cargar, guardar, guardarFechaReferencia, reiniciarCache, ARCHIVO };
