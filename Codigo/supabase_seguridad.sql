-- =====================================================================
-- NexuStock — supabase_seguridad.sql
-- Se aplica DESPUÉS de init.sql, solo en Supabase (etapa 1).
--
-- Supabase publica las tablas del esquema public mediante su Data API (PostgREST), que cualquiera puede
-- consultar con la clave publicable del proyecto (roles anon y authenticated). En NexuStock la única vía de
-- acceso a los datos es la API Express (Explicación General v2, sección 7), que se conecta con el rol
-- postgres. Este script cierra la Data API:
--   1. Activa Row Level Security sin políticas: anon y authenticated no ven ni modifican ninguna fila.
--   2. Retira todos los privilegios de esos roles sobre tablas, secuencias y funciones, también para los
--      objetos que se creen después.
-- El rol postgres es dueño de las tablas y no se ve afectado.
-- =====================================================================

BEGIN;

ALTER TABLE usuarios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias         ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_calendario ENABLE ROW LEVEL SECURITY;
ALTER TABLE modelos_ml         ENABLE ROW LEVEL SECURITY;
ALTER TABLE predicciones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE alertas_inventario ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

COMMIT;
