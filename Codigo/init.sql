-- =====================================================================
-- NexuStock — init.sql
-- Sistema Web Predictivo de Gestión de Inventario para Carnicerías
-- Modelo Entidad-Relación v4: 10 tablas, 12 relaciones (1:N)
-- Motor: PostgreSQL 15+
-- Fuente: 05 Documento de Diseño (Modelo E-R v4)
-- Dominios: Acceso | Catálogo | Transaccional | Predicción/Alertas
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Limpieza (re-ejecución segura en desarrollo)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS ALERTAS_INVENTARIO   CASCADE;
DROP TABLE IF EXISTS PREDICCIONES         CASCADE;
DROP TABLE IF EXISTS MODELOS_ML           CASCADE;
DROP TABLE IF EXISTS EVENTOS_CALENDARIO   CASCADE;
DROP TABLE IF EXISTS VENTAS               CASCADE;
DROP TABLE IF EXISTS COMPRAS              CASCADE;
DROP TABLE IF EXISTS PRODUCTOS            CASCADE;
DROP TABLE IF EXISTS PROVEEDORES          CASCADE;
DROP TABLE IF EXISTS CATEGORIAS           CASCADE;
DROP TABLE IF EXISTS USUARIOS             CASCADE;

-- =====================================================================
-- DOMINIO ACCESO
-- =====================================================================

-- 1. USUARIOS (Acceso & Control de Roles)
CREATE TABLE USUARIOS (
    id_usuario     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre         VARCHAR(120) NOT NULL,
    email          VARCHAR(160) NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    rol            VARCHAR(15)  NOT NULL,
    activo         BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_usuarios_rol
        CHECK (rol IN ('administrador', 'operador', 'ti'))
);

COMMENT ON TABLE  USUARIOS     IS 'Acceso y control de roles (administrador | operador | ti). Baja lógica con activo.';
COMMENT ON COLUMN USUARIOS.rol IS 'Dominio restringido: administrador | operador | ti.';

-- =====================================================================
-- DOMINIO CATÁLOGO
-- =====================================================================

-- 2. CATEGORIAS
CREATE TABLE CATEGORIAS (
    id_categoria   SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre         VARCHAR(40) NOT NULL UNIQUE
);

COMMENT ON TABLE CATEGORIAS IS 'Grupos de productos (Vacuno, Cerdo, Pollo, Embutidos). Base para estimar demanda de productos nuevos sin historial.';

-- 3. PROVEEDORES
CREATE TABLE PROVEEDORES (
    id_proveedor    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre          VARCHAR(120) NOT NULL UNIQUE,
    contacto        VARCHAR(160),
    lead_time_dias  SMALLINT     NOT NULL,
    dias_habiles    SMALLINT[]   NOT NULL,
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_proveedores_lead_time
        CHECK (lead_time_dias >= 0),
    -- Días de atención: 1 = lunes ... 7 = domingo (ISO 8601)
    CONSTRAINT chk_proveedores_dias_habiles
        CHECK (dias_habiles <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]
               AND cardinality(dias_habiles) >= 1)
);

COMMENT ON COLUMN PROVEEDORES.lead_time_dias IS 'Tiempo de respuesta habitual del proveedor, en días de corrido.';
COMMENT ON COLUMN PROVEEDORES.dias_habiles   IS 'Días de atención del proveedor (ISO: 1=lunes ... 7=domingo). Ej: {1,2,3,4,5} = lunes a viernes.';

-- 4. PRODUCTOS
CREATE TABLE PRODUCTOS (
    id_producto           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_categoria          SMALLINT      NOT NULL
        REFERENCES CATEGORIAS (id_categoria) ON UPDATE CASCADE ON DELETE RESTRICT,
    id_proveedor          BIGINT        NOT NULL
        REFERENCES PROVEEDORES (id_proveedor) ON UPDATE CASCADE ON DELETE RESTRICT,
    nombre                VARCHAR(120)  NOT NULL UNIQUE,
    unidad                VARCHAR(5)    NOT NULL,
    precio_venta_clp      INTEGER       NOT NULL,
    stock_actual          NUMERIC(10,2) NOT NULL DEFAULT 0,
    stock_minimo          NUMERIC(10,2) NOT NULL DEFAULT 0,
    vida_util_dias        SMALLINT,
    margen_seguridad_pct  NUMERIC(5,2)  NOT NULL DEFAULT 10.00,
    activo                BOOLEAN       NOT NULL DEFAULT TRUE,
    creado_en             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_productos_unidad          CHECK (unidad IN ('kg', 'un')),
    CONSTRAINT chk_productos_precio          CHECK (precio_venta_clp >= 0),
    CONSTRAINT chk_productos_stock_actual    CHECK (stock_actual >= 0),
    CONSTRAINT chk_productos_stock_minimo    CHECK (stock_minimo >= 0),
    CONSTRAINT chk_productos_vida_util       CHECK (vida_util_dias IS NULL OR vida_util_dias > 0),
    CONSTRAINT chk_productos_margen          CHECK (margen_seguridad_pct >= 0)
);

COMMENT ON COLUMN PRODUCTOS.unidad               IS 'Dominio: kg | un.';
COMMENT ON COLUMN PRODUCTOS.stock_actual         IS 'Existencia física en tiempo real.';
COMMENT ON COLUMN PRODUCTOS.stock_minimo         IS 'Umbral base para alertas locales.';
COMMENT ON COLUMN PRODUCTOS.margen_seguridad_pct IS 'Porcentaje de colchón de seguridad (por defecto 10.00).';

-- =====================================================================
-- DOMINIO TRANSACCIONAL
-- =====================================================================

-- 5. COMPRAS (recepción de mercadería)
CREATE TABLE COMPRAS (
    id_compra           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_producto         BIGINT        NOT NULL
        REFERENCES PRODUCTOS (id_producto) ON UPDATE CASCADE ON DELETE RESTRICT,
    id_proveedor        BIGINT        NOT NULL
        REFERENCES PROVEEDORES (id_proveedor) ON UPDATE CASCADE ON DELETE RESTRICT,
    id_usuario          BIGINT        NOT NULL
        REFERENCES USUARIOS (id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT,
    fecha_hora          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    cantidad            NUMERIC(10,2) NOT NULL,
    costo_unitario_clp  INTEGER       NOT NULL,
    costo_total_clp     INTEGER       NOT NULL,
    CONSTRAINT chk_compras_cantidad  CHECK (cantidad > 0),
    CONSTRAINT chk_compras_costo_u   CHECK (costo_unitario_clp >= 0),
    CONSTRAINT chk_compras_costo_t   CHECK (costo_total_clp >= 0)
);

-- 6. VENTAS (ticket de venta)
CREATE TABLE VENTAS (
    id_venta            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_producto         BIGINT        NOT NULL
        REFERENCES PRODUCTOS (id_producto) ON UPDATE CASCADE ON DELETE RESTRICT,
    id_usuario          BIGINT        NOT NULL
        REFERENCES USUARIOS (id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT,
    fecha_hora          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    cantidad            NUMERIC(10,2) NOT NULL,
    precio_unitario_clp INTEGER       NOT NULL,
    total_clp           INTEGER       NOT NULL,
    CONSTRAINT chk_ventas_cantidad   CHECK (cantidad > 0),
    CONSTRAINT chk_ventas_precio_u   CHECK (precio_unitario_clp >= 0),
    CONSTRAINT chk_ventas_total      CHECK (total_clp >= 0)
);

-- =====================================================================
-- FEATURE ENGINEERING (sin FK, a propósito)
-- =====================================================================

-- 7. EVENTOS_CALENDARIO
-- Se cruza por rango de fechas con VENTAS y PREDICCIONES para calcular
-- estacionalidad, quincenas y fines de mes.
CREATE TABLE EVENTOS_CALENDARIO (
    id_evento  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha      DATE        NOT NULL,
    nombre     VARCHAR(80) NOT NULL,
    tipo       VARCHAR(25) NOT NULL,
    CONSTRAINT chk_eventos_tipo
        CHECK (tipo IN ('fiestas_patrias', 'semana_santa', 'feriado_largo', 'feriado', 'otro'))
);

COMMENT ON TABLE EVENTOS_CALENDARIO IS 'Hitos del calendario (feriados, Semana Santa, Fiestas Patrias). Sin llaves foráneas: se cruza por rango de fechas.';

-- =====================================================================
-- DOMINIO PREDICCIÓN / ALERTAS
-- =====================================================================

-- 8. MODELOS_ML
CREATE TABLE MODELOS_ML (
    id_modelo        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    algoritmo        VARCHAR(60)  NOT NULL,
    version          VARCHAR(20)  NOT NULL,
    mae_general      NUMERIC(8,3) NOT NULL,
    mae_festivos     NUMERIC(8,3),
    entrenado_desde  DATE         NOT NULL,
    entrenado_hasta  DATE         NOT NULL,
    prueba_desde     DATE         NOT NULL,
    prueba_hasta     DATE         NOT NULL,
    artefacto_ruta   VARCHAR(200) NOT NULL,
    activo           BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_modelos_mae_general   CHECK (mae_general >= 0),
    CONSTRAINT chk_modelos_mae_festivos  CHECK (mae_festivos IS NULL OR mae_festivos >= 0),
    CONSTRAINT chk_modelos_ventana_train CHECK (entrenado_hasta >= entrenado_desde),
    CONSTRAINT chk_modelos_ventana_test  CHECK (prueba_hasta >= prueba_desde)
);

COMMENT ON COLUMN MODELOS_ML.mae_general    IS 'Error Medio Absoluto (MAE) en el conjunto de prueba, expresado en kg.';
COMMENT ON COLUMN MODELOS_ML.mae_festivos   IS 'MAE en ventanas festivas de alta demanda.';
COMMENT ON COLUMN MODELOS_ML.artefacto_ruta IS 'Ruta relativa al archivo .pkl/.joblib del modelo entrenado.';
COMMENT ON COLUMN MODELOS_ML.activo         IS 'Indica el modelo en producción actual.';

-- A lo más un modelo activo a la vez
CREATE UNIQUE INDEX uq_modelos_ml_activo ON MODELOS_ML (activo) WHERE activo;

-- 9. PREDICCIONES
CREATE TABLE PREDICCIONES (
    id_prediccion   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_producto     BIGINT        NOT NULL
        REFERENCES PRODUCTOS (id_producto) ON UPDATE CASCADE ON DELETE RESTRICT,
    id_modelo       BIGINT
        REFERENCES MODELOS_ML (id_modelo) ON UPDATE CASCADE ON DELETE SET NULL,
    horizonte       VARCHAR(8)    NOT NULL,
    fecha_objetivo  DATE          NOT NULL,
    demanda_pred    NUMERIC(10,2) NOT NULL,
    origen          VARCHAR(20)   NOT NULL,
    latencia_ms     INTEGER,
    generada_en     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_pred_horizonte CHECK (horizonte IN ('semana', 'mes')),
    CONSTRAINT chk_pred_origen    CHECK (origen IN ('modelo', 'promedio_historico', 'categoria')),
    CONSTRAINT chk_pred_demanda   CHECK (demanda_pred >= 0),
    CONSTRAINT chk_pred_latencia  CHECK (latencia_ms IS NULL OR latencia_ms >= 0)
);

COMMENT ON COLUMN PREDICCIONES.id_modelo    IS 'NULL si la predicción se obtuvo por mecanismo de respaldo.';
COMMENT ON COLUMN PREDICCIONES.demanda_pred IS 'Demanda proyectada en kilogramos.';
COMMENT ON COLUMN PREDICCIONES.origen       IS 'modelo | promedio_historico | categoria.';
COMMENT ON COLUMN PREDICCIONES.latencia_ms  IS 'Tiempo de ejecución del script Python (ms).';

-- 10. ALERTAS_INVENTARIO (motor de reglas y sugerencias de compra)
CREATE TABLE ALERTAS_INVENTARIO (
    id_alerta               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_producto             BIGINT        NOT NULL
        REFERENCES PRODUCTOS (id_producto) ON UPDATE CASCADE ON DELETE RESTRICT,
    id_proveedor            BIGINT        NOT NULL
        REFERENCES PROVEEDORES (id_proveedor) ON UPDATE CASCADE ON DELETE RESTRICT,
    id_prediccion           BIGINT
        REFERENCES PREDICCIONES (id_prediccion) ON UPDATE CASCADE ON DELETE SET NULL,
    nivel                   VARCHAR(10)   NOT NULL,
    stock_actual            NUMERIC(10,2) NOT NULL,
    demanda_proyectada      NUMERIC(10,2) NOT NULL,
    margen_seguridad_pct    NUMERIC(5,2)  NOT NULL,
    cantidad_sugerida       NUMERIC(10,2) NOT NULL,
    lead_time_dias          SMALLINT      NOT NULL,
    fecha_quiebre_estimada  DATE          NOT NULL,
    fecha_limite_pedido     DATE          NOT NULL,
    estado                  VARCHAR(10)   NOT NULL DEFAULT 'activa',
    creada_en               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    resuelta_en             TIMESTAMPTZ,
    CONSTRAINT chk_alertas_nivel   CHECK (nivel  IN ('quiebre', 'bajo', 'optimo')),
    CONSTRAINT chk_alertas_estado  CHECK (estado IN ('activa', 'atendida', 'descartada')),
    CONSTRAINT chk_alertas_stock   CHECK (stock_actual >= 0),
    CONSTRAINT chk_alertas_demanda CHECK (demanda_proyectada >= 0),
    CONSTRAINT chk_alertas_margen  CHECK (margen_seguridad_pct >= 0),
    CONSTRAINT chk_alertas_cant    CHECK (cantidad_sugerida >= 0),
    CONSTRAINT chk_alertas_lead    CHECK (lead_time_dias >= 0),
    -- Una alerta activa no tiene fecha de resolución; una resuelta sí
    CONSTRAINT chk_alertas_resolucion
        CHECK ((estado = 'activa' AND resuelta_en IS NULL)
            OR (estado <> 'activa' AND resuelta_en IS NOT NULL))
);

COMMENT ON COLUMN ALERTAS_INVENTARIO.id_prediccion          IS 'NULL si la alerta se generó solo por quiebre de stock mínimo local.';
COMMENT ON COLUMN ALERTAS_INVENTARIO.nivel                  IS 'Nivel registrado: quiebre (rojo) | bajo (amarillo) | optimo (verde). El semáforo es solo visual.';
COMMENT ON COLUMN ALERTAS_INVENTARIO.stock_actual           IS 'Fotografía de existencia al momento de la alerta.';
COMMENT ON COLUMN ALERTAS_INVENTARIO.cantidad_sugerida      IS 'Kilos recomendados a pedir al proveedor.';
COMMENT ON COLUMN ALERTAS_INVENTARIO.lead_time_dias         IS 'Lead time del proveedor capturado en la alerta.';
COMMENT ON COLUMN ALERTAS_INVENTARIO.fecha_limite_pedido    IS 'Fecha máxima para emitir el pedido, ajustada al día hábil anterior según dias_habiles del proveedor.';
COMMENT ON COLUMN ALERTAS_INVENTARIO.estado                 IS 'activa | atendida | descartada.';
COMMENT ON COLUMN ALERTAS_INVENTARIO.resuelta_en            IS 'Momento en que el administrador la atendió o descartó.';

-- =====================================================================
-- ÍNDICES (consultas del dashboard, series de tiempo y motor de alertas)
-- Las PK y UNIQUE ya generan su índice; aquí se indexan las FK y fechas.
-- =====================================================================

CREATE INDEX idx_productos_categoria     ON PRODUCTOS (id_categoria);
CREATE INDEX idx_productos_proveedor     ON PRODUCTOS (id_proveedor);

CREATE INDEX idx_ventas_producto_fecha   ON VENTAS  (id_producto, fecha_hora);
CREATE INDEX idx_ventas_usuario          ON VENTAS  (id_usuario);
CREATE INDEX idx_ventas_fecha            ON VENTAS  (fecha_hora);

CREATE INDEX idx_compras_producto_fecha  ON COMPRAS (id_producto, fecha_hora);
CREATE INDEX idx_compras_proveedor       ON COMPRAS (id_proveedor);
CREATE INDEX idx_compras_usuario         ON COMPRAS (id_usuario);
CREATE INDEX idx_compras_fecha           ON COMPRAS (fecha_hora);

CREATE INDEX idx_eventos_fecha           ON EVENTOS_CALENDARIO (fecha);

CREATE INDEX idx_pred_producto_objetivo  ON PREDICCIONES (id_producto, fecha_objetivo);
CREATE INDEX idx_pred_modelo             ON PREDICCIONES (id_modelo);

CREATE INDEX idx_alertas_producto        ON ALERTAS_INVENTARIO (id_producto);
CREATE INDEX idx_alertas_proveedor       ON ALERTAS_INVENTARIO (id_proveedor);
CREATE INDEX idx_alertas_prediccion      ON ALERTAS_INVENTARIO (id_prediccion);
CREATE INDEX idx_alertas_activas         ON ALERTAS_INVENTARIO (nivel, fecha_limite_pedido)
    WHERE estado = 'activa';

-- =====================================================================
-- DATOS INICIALES (categorías de ejemplo del Documento de Diseño)
-- =====================================================================

INSERT INTO CATEGORIAS (nombre) VALUES
    ('Vacuno'),
    ('Cerdo'),
    ('Pollo'),
    ('Embutidos');

COMMIT;
