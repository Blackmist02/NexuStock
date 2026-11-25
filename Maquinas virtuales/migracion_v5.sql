-- =====================================================================
-- NexuStock — migracion_v5.sql
-- Lleva una base del modelo v4 (10 tablas) al v5: agrega CONFIGURACION y MERMAS.
-- Es idempotente (se puede ejecutar más de una vez) y no modifica datos existentes.
-- Se ejecuta en el SQL Editor de Supabase (en el proyecto que usa el backend) o con psql en la base local.
-- Al iniciar, el backend copia en CONFIGURACION el contenido de data/negocio.json (si existe).
-- Todas las tablas van con el esquema public explícito: no depende del search_path de la sesión.
-- =====================================================================

BEGIN;

-- Verificación: esta base debe tener el esquema de NexuStock (init.sql) en public
DO $$
BEGIN
    IF to_regclass('public.usuarios') IS NULL OR to_regclass('public.productos') IS NULL THEN
        RAISE EXCEPTION 'Esta base no tiene las tablas de NexuStock en el esquema public (base: %). '
                        'Revisa que el SQL Editor esté en el proyecto de Supabase que usa el backend.', current_database();
    END IF;
END $$;

-- 11. CONFIGURACION (parámetros de la instalación: negocio, alertas y fecha de referencia)
CREATE TABLE IF NOT EXISTS public.configuracion (
    clave           VARCHAR(40)   PRIMARY KEY,
    valor           JSONB         NOT NULL,
    id_usuario      BIGINT
        REFERENCES public.usuarios (id_usuario) ON UPDATE CASCADE ON DELETE SET NULL,
    actualizado_en  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.configuracion       IS 'Parámetros de la instalación (una por carnicería), clave/valor.';
COMMENT ON COLUMN public.configuracion.clave IS 'negocio = { nombre, alertas: { quiebre, bajo } } | fecha_referencia = { fecha: AAAA-MM-DD o null }.';
COMMENT ON COLUMN public.configuracion.valor IS 'Valor en JSON. fecha_referencia.fecha = null: el sistema usa la fecha real.';

-- 12. MERMAS (producto dado de baja: vencimiento, deterioro u otro)
CREATE TABLE IF NOT EXISTS public.mermas (
    id_merma            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_producto         BIGINT        NOT NULL
        REFERENCES public.productos (id_producto) ON UPDATE CASCADE ON DELETE RESTRICT,
    id_usuario          BIGINT        NOT NULL
        REFERENCES public.usuarios (id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT,
    fecha_hora          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    cantidad            NUMERIC(10,2) NOT NULL,
    motivo              VARCHAR(12)   NOT NULL DEFAULT 'vencimiento',
    costo_unitario_clp  INTEGER,
    costo_total_clp     INTEGER,
    CONSTRAINT chk_mermas_cantidad CHECK (cantidad > 0),
    CONSTRAINT chk_mermas_motivo   CHECK (motivo IN ('vencimiento', 'deterioro', 'otro')),
    CONSTRAINT chk_mermas_costo_u  CHECK (costo_unitario_clp IS NULL OR costo_unitario_clp >= 0),
    CONSTRAINT chk_mermas_costo_t  CHECK (costo_total_clp IS NULL OR costo_total_clp >= 0)
);

COMMENT ON TABLE  public.mermas                    IS 'Bajas de stock por vencimiento, deterioro u otro motivo (descuentan stock_actual).';
COMMENT ON COLUMN public.mermas.costo_unitario_clp IS 'Costo por unidad del producto dado de baja (opcional).';

CREATE INDEX IF NOT EXISTS idx_mermas_producto_fecha ON public.mermas (id_producto, fecha_hora);
CREATE INDEX IF NOT EXISTS idx_mermas_fecha          ON public.mermas (fecha_hora);
CREATE INDEX IF NOT EXISTS idx_mermas_usuario        ON public.mermas (id_usuario);

-- Base ya cargada sin mermas registradas: su stock_actual ya las descuenta (cargar_bd.py usa la ecuación de inventario).
-- Se anota el último día cargado para que la carga por CSV importe mermas solo desde el día siguiente.
INSERT INTO public.configuracion (clave, valor)
SELECT 'mermas_incluidas_hasta',
       jsonb_build_object('fecha', to_char(GREATEST((SELECT MAX(fecha_hora) FROM public.ventas), (SELECT MAX(fecha_hora) FROM public.compras))
                                           AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD'))
 WHERE NOT EXISTS (SELECT 1 FROM public.mermas)
   AND EXISTS (SELECT 1 FROM public.ventas)
ON CONFLICT (clave) DO NOTHING;

-- En Supabase, las tablas nuevas quedan igual de cerradas a la Data API que las demás (supabase_seguridad.sql)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        ALTER TABLE public.configuracion ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.mermas        ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON public.configuracion, public.mermas FROM anon, authenticated;
        REVOKE ALL ON SEQUENCE public.mermas_id_merma_seq FROM anon, authenticated;
    END IF;
END $$;

COMMIT;
