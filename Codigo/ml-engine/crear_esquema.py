"""Crea el esquema de NexuStock (init.sql) en una base PostgreSQL vacía: Supabase o el proveedor definitivo.

Uso (desde ml-engine, con el .venv activo):

    python crear_esquema.py --env-url SUPABASE_DB_URL --supabase
    python crear_esquema.py --url postgresql://...            # etapa 2: PostgreSQL del proveedor definitivo

--env-url lee la URL de ../.env sin mostrarla. --supabase aplica además supabase_seguridad.sql, que cierra la
Data API pública. Si la base ya tiene las tablas, se detiene: init.sql las borra y recrea. Para hacerlo igual,
usar --reemplazar (se pierden los datos).
"""
import argparse
import sys
from pathlib import Path

import psycopg

CODIGO = Path(__file__).resolve().parent.parent
TABLAS = ['usuarios', 'categorias', 'proveedores', 'productos', 'compras', 'ventas', 'eventos_calendario',
          'modelos_ml', 'predicciones', 'alertas_inventario', 'configuracion', 'mermas']


def leer_env(nombre):
    ruta = CODIGO / '.env'
    for linea in ruta.read_text(encoding='utf-8').splitlines():
        if linea.startswith(f'{nombre}='):
            return linea.split('=', 1)[1].strip()
    sys.exit(f'No se encontró {nombre} en {ruta}')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    origen = ap.add_mutually_exclusive_group(required=True)
    origen.add_argument('--url', help='URL de conexión')
    origen.add_argument('--env-url', help='nombre de la variable de ../.env que contiene la URL')
    ap.add_argument('--supabase', action='store_true', help='aplica también supabase_seguridad.sql')
    ap.add_argument('--reemplazar', action='store_true', help='recrea las tablas aunque existan (borra los datos)')
    args = ap.parse_args()
    url = args.url or leer_env(args.env_url)

    with psycopg.connect(url, autocommit=True, sslmode='prefer') as conn:
        existentes = [r[0] for r in conn.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(%s)",
            (TABLAS,))]
        if existentes and not args.reemplazar:
            sys.exit(f'La base ya tiene {len(existentes)} tablas de NexuStock. Usa --reemplazar para recrearlas '
                     '(se pierden los datos).')

        conn.execute((CODIGO / 'init.sql').read_text(encoding='utf-8'))
        print('init.sql aplicado')
        if args.supabase:
            conn.execute((CODIGO / 'supabase_seguridad.sql').read_text(encoding='utf-8'))
            print('supabase_seguridad.sql aplicado')

        n = conn.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' "
                         'AND table_name = ANY(%s)', (TABLAS,)).fetchone()[0]
        categorias = [r[0] for r in conn.execute('SELECT nombre FROM categorias ORDER BY id_categoria')]
        print(f'Tablas: {n}/10 · Categorías: {", ".join(categorias)}')
        if args.supabase:
            rls = conn.execute("SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity "
                               'AND tablename = ANY(%s)', (TABLAS,)).fetchone()[0]
            privilegios = conn.execute(
                "SELECT COUNT(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' "
                "AND grantee IN ('anon', 'authenticated')").fetchone()[0]
            print(f'RLS activo en {rls}/10 tablas · privilegios de anon/authenticated: {privilegios}')


if __name__ == '__main__':
    main()
