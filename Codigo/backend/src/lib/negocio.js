/**
 * Parámetros de la instalación (una instalación por carnicería): nombre del negocio y activación de las alertas.
 * Se guardan en un archivo JSON (backend/data/negocio.json) y no en la base de datos, porque el modelo v4
 * no tiene una tabla de configuración (Documento 01, RF-12).
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

const ARCHIVO = path.join(config.dataDir, 'negocio.json');
const POR_DEFECTO = { nombre: 'Mi carnicería', alertas: { quiebre: true, bajo: true } };

let cache = null;

function leer() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    cache = {
      nombre: typeof raw.nombre === 'string' && raw.nombre.trim() ? raw.nombre.trim() : POR_DEFECTO.nombre,
      alertas: { ...POR_DEFECTO.alertas, ...(raw.alertas || {}) }
    };
  } catch {
    cache = structuredClone(POR_DEFECTO);
  }
  return cache;
}

function guardar(parcial) {
  const actual = leer();
  const nuevo = {
    nombre: parcial.nombre !== undefined ? String(parcial.nombre).trim() : actual.nombre,
    alertas: { ...actual.alertas, ...(parcial.alertas || {}) }
  };
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${ARCHIVO}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(nuevo, null, 2));
  fs.renameSync(tmp, ARCHIVO);
  cache = nuevo;
  return nuevo;
}

/** Solo para pruebas. */
const reiniciarCache = () => {
  cache = null;
};

module.exports = { leer, guardar, reiniciarCache, ARCHIVO };
