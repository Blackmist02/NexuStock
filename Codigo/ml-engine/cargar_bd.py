"""Carga los datos de data/raw en la base de NexuStock (PostgreSQL local o Supabase).

Uso (desde ml-engine, con el .venv activo):

    python cargar_bd.py --hasta 2023-12-31            # primera carga: catálogo, calendario, modelo e historia
    python cargar_bd.py --hasta 2024-03-31            # agrega las ventas y compras hasta esa fecha
    python cargar_bd.py --hasta 2024-03-31 --reemplazar   # borra catálogo y transacciones, y carga de nuevo
    python cargar_bd.py --hasta 2024-09-07 --env-url SUPABASE_DB_URL   # en Supabase (URL leída de ../.env)

Conexión: usa DATABASE_URL si está definida; si no, arma la URL local con los valores de ../.env
(POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, DB_PORT). Con --url se indica otra base.

Requisitos de la base:
  - Esquema creado con init.sql (incluye las 5 categorías).
  - Al menos un usuario administrador: las ventas y compras históricas se registran a su nombre.
    Créalo antes desde «Crear cuenta» en la plataforma.

Notas:
  - --hasta es el último día cargado (conviene un domingo): no se carga nada posterior, y stock_actual queda como el
    stock reconstruido al cierre de ese día (inventario inicial + compras recibidas − ventas − mermas).
    En el backend, FECHA_REFERENCIA debe ser el día siguiente (el lunes): el sistema proyecta la semana en curso.
  - EVENTOS_CALENDARIO guarda un día por fila: los eventos de varios días se expanden.
  - Los productos quedan con id_producto 1..24 en el orden P001..P024 solo en una base recién creada o con --reemplazar.
  - Para cada semana de 2024 ya iniciada al --hasta, registra en PREDICCIONES la predicción del modelo hecha con los
    datos hasta el domingo anterior, como lo habría hecho el backend (se omite con --sin-predicciones).
"""
import argparse
import os
import sys
import time
from pathlib import Path

import pandas as pd
import psycopg

BASE = Path(__file__).resolve().parent
RAW = BASE / 'data' / 'raw'
MODELS = BASE / 'models'
ENV = BASE.parent / '.env'
TZ = 'America/Santiago'
INICIO_DATOS = pd.Timestamp('2022-01-01')
PRIMERA_SEMANA_PRUEBA = pd.Timestamp('2024-01-01')


def valores_env():
    valores = {}
    if ENV.exists():
        for linea in ENV.read_text(encoding='utf-8').splitlines():
            linea = linea.strip()
            if linea and not linea.startswith('#') and '=' in linea:
                k, v = linea.split('=', 1)
                valores[k.strip()] = v.strip()
    return valores


def leer_env(nombre):
    valor = valores_env().get(nombre)
    if not valor:
        sys.exit(f'No se encontró {nombre} en {ENV}')
    return valor


def url_local():
    valores = valores_env()
    usuario = valores.get('POSTGRES_USER', 'nexustock')
    clave = valores.get('POSTGRES_PASSWORD', 'nexustock_dev')
    base = valores.get('POSTGRES_DB', 'nexustock')
    puerto = valores.get('DB_PORT', '5433')
    return f'postgresql://{usuario}:{clave}@localhost:{puerto}/{base}'


def leer_anios(patron):
    return pd.concat([pd.read_csv(f) for f in sorted(RAW.glob(patron))], ignore_index=True)


def leer_datos(hasta):
    ventas = leer_anios('20*/ventas_*.csv')
    compras = leer_anios('20*/compras_*.csv')
    mermas = leer_anios('20*/mermas_*.csv')
    ventas['fecha'] = pd.to_datetime(ventas['fecha'])
    compras['fecha_recepcion'] = pd.to_datetime(compras['fecha_recepcion'])
    mermas['fecha'] = pd.to_datetime(mermas['fecha'])
    return {
        'ventas': ventas[ventas['fecha'] <= hasta],
        'compras': compras[compras['fecha_recepcion'] <= hasta],
        'mermas': mermas[mermas['fecha'] <= hasta],
        'productos': pd.read_csv(RAW / 'productos.csv'),
        'proveedores': pd.read_csv(RAW / 'proveedores.csv'),
        'calendario': pd.read_csv(RAW / 'calendario_eventos.csv', parse_dates=['fecha_inicio', 'fecha_fin']),
        'inventario': pd.read_csv(RAW / 'inventario_inicial_2022-01-01.csv', parse_dates=['fecha_recepcion']),
    }


def stock_al_cierre(d, hasta):
    """Stock por producto al cierre de `hasta`: inventario inicial + compras recibidas − ventas − mermas."""
    inv = d['inventario'][d['inventario']['fecha_recepcion'].clip(lower=INICIO_DATOS) <= hasta]
    stock = (inv.groupby('producto_id')['cantidad_kg'].sum()
             .add(d['compras'].groupby('producto_id')['cantidad_kg'].sum(), fill_value=0)
             .sub(d['ventas'].groupby('producto_id')['cantidad_kg'].sum(), fill_value=0)
             .sub(d['mermas'].groupby('producto_id')['cantidad_kg'].sum(), fill_value=0))
    return stock.clip(lower=0).round(2)


def precio_vigente(d):
    """Último precio de mostrador (cliente C000, sin descuento) de cada producto."""
    mostrador = d['ventas'][d['ventas']['cliente_id'] == 'C000'].sort_values(['fecha', 'hora'])
    return mostrador.groupby('producto_id')['precio_unitario_venta_clp'].last()


def id_administrador(cur):
    cur.execute("SELECT id_usuario FROM usuarios WHERE rol = 'administrador' AND activo ORDER BY id_usuario LIMIT 1")
    fila = cur.fetchone()
    if fila is None:
        sys.exit('No hay un usuario administrador. Crea la cuenta desde «Crear cuenta» y vuelve a ejecutar.')
    return fila[0]


def cargar_catalogo(cur, d, hasta):
    prov_ids = {}
    for _, p in d['proveedores'].iterrows():
        cur.execute(
            """INSERT INTO proveedores (nombre, contacto, lead_time_dias, dias_habiles, activo)
               VALUES (%s, %s, %s, %s, %s) RETURNING id_proveedor""",
            (p['nombre_proveedor'], p['ciudad_region'], int(p['lead_time_dias']),
             [int(x) for x in str(p['dias_habiles']).split(',')], bool(p['activo'])))
        prov_ids[p['proveedor_id']] = cur.fetchone()[0]

    cur.execute('SELECT nombre, id_categoria FROM categorias')
    cat_ids = dict(cur.fetchall())
    faltantes = set(d['productos']['categoria']) - set(cat_ids)
    if faltantes:
        sys.exit(f'Faltan categorías en la base: {sorted(faltantes)}')

    stock = stock_al_cierre(d, hasta)
    precios = precio_vigente(d)
    prod_ids = {}
    for _, p in d['productos'].iterrows():
        cur.execute(
            """INSERT INTO productos (id_categoria, id_proveedor, nombre, unidad, precio_venta_clp, stock_actual,
                                      stock_minimo, vida_util_dias, margen_seguridad_pct)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id_producto""",
            (cat_ids[p['categoria']], prov_ids[p['proveedor_id']], p['nombre_producto'], p['unidad_medida'],
             int(precios.get(p['producto_id'], p['precio_venta_referencia_2022'])),
             float(stock.get(p['producto_id'], 0)), float(p['stock_minimo_kg']),
             int(p['vida_util_dias']), float(p['margen_seguridad_pct'])))
        prod_ids[p['producto_id']] = cur.fetchone()[0]
    return prov_ids, prod_ids


def cargar_calendario(cur, d):
    filas = []
    for _, e in d['calendario'].iterrows():
        for dia in pd.date_range(e['fecha_inicio'], e['fecha_fin'], freq='D'):
            filas.append((dia.date(), e['evento'][:80], e['tipo']))
    with cur.copy('COPY eventos_calendario (fecha, nombre, tipo) FROM STDIN') as copia:
        for f in filas:
            copia.write_row(f)
    return len(filas)


def registrar_modelo(cur):
    sql = MODELS / 'registro_modelos_ml.sql'
    if not sql.exists():
        print('  (sin models/registro_modelos_ml.sql: ejecuta el notebook 03 para registrar el modelo)')
        return
    cur.execute('SELECT COUNT(*) FROM modelos_ml')
    if cur.fetchone()[0] == 0:
        cur.execute(sql.read_text(encoding='utf-8'))
        print('  MODELOS_ML: modelo registrado como activo')


def mapas(cur):
    """Correspondencia P001 -> id_producto y PR001 -> id_proveedor según los nombres en la base."""
    cur.execute('SELECT nombre, id_producto FROM productos')
    por_nombre = dict(cur.fetchall())
    cur.execute('SELECT nombre, id_proveedor FROM proveedores')
    prov_nombre = dict(cur.fetchall())
    return por_nombre, prov_nombre


def cargar_transacciones(cur, d, prod_ids, prov_ids, id_usuario, desde_ventas, desde_compras):
    ventas = d['ventas'][d['ventas']['fecha'] > desde_ventas]
    compras = d['compras'][d['compras']['fecha_recepcion'] > desde_compras]
    with cur.copy('COPY ventas (id_producto, id_usuario, fecha_hora, cantidad, precio_unitario_clp, total_clp) '
                  'FROM STDIN') as copia:
        for v in ventas.itertuples(index=False):
            copia.write_row((prod_ids[v.producto_id], id_usuario, f'{v.fecha.date()} {v.hora}',
                             v.cantidad_kg, v.precio_unitario_venta_clp, v.total_venta_clp))
    with cur.copy('COPY compras (id_producto, id_proveedor, id_usuario, fecha_hora, cantidad, '
                  'costo_unitario_clp, costo_total_clp) FROM STDIN') as copia:
        for c in compras.itertuples(index=False):
            copia.write_row((prod_ids[c.producto_id], prov_ids[c.proveedor_id], id_usuario,
                             f'{c.fecha_recepcion.date()} 08:00', c.cantidad_kg,
                             c.precio_unitario_compra_clp, c.costo_total_clp))
    return len(ventas), len(compras)


def generar_predicciones(cur, hasta):
    """Predicción semanal del modelo para cada semana de prueba (2024) ya iniciada al `hasta`.

    Reproduce lo que habría registrado el backend si hubiera estado en marcha: cada semana se predice solo con
    las ventas de las 8 semanas anteriores, leídas desde la base. Así el gráfico del dashboard muestra la venta
    real contra la predicha. No se generan semanas de 2022-2023 porque el modelo se entrenó con ellas.
    """
    import predict

    cur.execute('SELECT id_modelo FROM modelos_ml WHERE activo ORDER BY id_modelo DESC LIMIT 1')
    fila = cur.fetchone()
    if fila is None:
        print('  (sin modelo activo en MODELOS_ML: no se generan predicciones)')
        return
    id_modelo = fila[0]
    semanas = pd.date_range(PRIMERA_SEMANA_PRUEBA, hasta, freq='W-MON')
    cur.execute("""SELECT DISTINCT fecha_objetivo FROM predicciones
                    WHERE origen = 'modelo' AND horizonte = 'semana' AND id_modelo = %s""", (id_modelo,))
    hechas = {pd.Timestamp(r[0]) for r in cur.fetchall()}
    semanas = [s for s in semanas if s not in hechas]
    if not semanas:
        return

    artefacto = predict.cargar_modelo()
    cur.execute("""SELECT p.id_producto, c.nombre FROM productos p JOIN categorias c USING (id_categoria)
                    WHERE p.activo ORDER BY p.id_producto""")
    productos = cur.fetchall()
    cur.execute("""SELECT id_producto, (date_trunc('week', fecha_hora AT TIME ZONE %s))::date, SUM(cantidad)::float
                     FROM ventas WHERE fecha_hora >= %s GROUP BY 1, 2""",
                (TZ, (semanas[0] - pd.Timedelta(weeks=predict.SEMANAS_HISTORIAL)).date()))
    kg = {}
    for id_p, semana, total in cur.fetchall():
        kg.setdefault(id_p, {})[pd.Timestamp(semana)] = total
    cur.execute("SELECT to_char(fecha, 'YYYY-MM-DD'), nombre, tipo FROM eventos_calendario")
    eventos = [{'fecha': f, 'nombre': n, 'tipo': t} for f, n, t in cur.fetchall()]

    filas = []
    for semana in semanas:
        inicio = pd.Timestamp(semana) - pd.Timedelta(weeks=predict.SEMANAS_HISTORIAL)
        solicitud = {
            'fecha_objetivo': semana.date().isoformat(),
            'eventos': eventos,
            'productos': [{'producto_id': id_p, 'categoria': cat,
                           'ventas_semanales': [{'semana': s.date().isoformat(), 'kg': v}
                                                for s, v in kg.get(id_p, {}).items() if inicio <= s < semana]}
                          for id_p, cat in productos],
        }
        t0 = time.perf_counter()
        resultado = predict.predecir(solicitud, artefacto, 'semana')
        latencia = round((time.perf_counter() - t0) * 1000)
        filas += [(r['producto_id'], id_modelo, 'semana', semana.date(), r['demanda_kg'], 'modelo', latencia)
                  for r in resultado if 'demanda_kg' in r]
    with cur.copy('COPY predicciones (id_producto, id_modelo, horizonte, fecha_objetivo, demanda_pred, origen, '
                  'latencia_ms) FROM STDIN') as copia:
        for f in filas:
            copia.write_row(f)
    print(f'  PREDICCIONES: {len(filas)} del modelo ({len(semanas)} semanas, desde {semanas[0].date()})')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--hasta', required=True, help='fecha de referencia (AAAA-MM-DD), inclusive')
    ap.add_argument('--url', help='URL de conexión; por defecto DATABASE_URL o la base local de ../.env')
    ap.add_argument('--env-url', help='nombre de la variable de ../.env con la URL (ej.: SUPABASE_DB_URL)')
    ap.add_argument('--reemplazar', action='store_true',
                    help='borra catálogo, calendario, modelo y transacciones antes de cargar')
    ap.add_argument('--sin-predicciones', action='store_true',
                    help='no genera las predicciones semanales de 2024 hasta la fecha de referencia')
    args = ap.parse_args()

    hasta = pd.Timestamp(args.hasta)
    if not INICIO_DATOS <= hasta <= pd.Timestamp('2024-12-31'):
        sys.exit('--hasta debe estar entre 2022-01-01 y 2024-12-31')
    url = args.url or (leer_env(args.env_url) if args.env_url else None) or os.environ.get('DATABASE_URL') or url_local()

    inicio = time.perf_counter()
    d = leer_datos(hasta)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(f"SET LOCAL TIME ZONE '{TZ}'")
        id_usuario = id_administrador(cur)

        if args.reemplazar:
            cur.execute('TRUNCATE alertas_inventario, predicciones, modelos_ml, eventos_calendario, ventas, compras, '
                        'productos, proveedores RESTART IDENTITY CASCADE')
            print('Datos anteriores eliminados (usuarios y categorías se conservan)')

        cur.execute('SELECT COUNT(*) FROM productos')
        primera_carga = cur.fetchone()[0] == 0

        if primera_carga:
            print(f'Primera carga hasta {hasta.date()}')
            prov_ids, prod_ids = cargar_catalogo(cur, d, hasta)
            print(f'  PROVEEDORES: {len(prov_ids)} · PRODUCTOS: {len(prod_ids)}')
            print(f'  EVENTOS_CALENDARIO: {cargar_calendario(cur, d)} días con evento')
            registrar_modelo(cur)
            desde_ventas = desde_compras = INICIO_DATOS - pd.Timedelta(days=1)
        else:
            por_nombre, prov_nombre = mapas(cur)
            prod_ids = {p: por_nombre[n] for p, n in zip(d['productos']['producto_id'],
                                                         d['productos']['nombre_producto'])}
            prov_ids = {p: prov_nombre[n] for p, n in zip(d['proveedores']['proveedor_id'],
                                                         d['proveedores']['nombre_proveedor'])}
            cur.execute('SELECT MAX(fecha_hora)::date FROM ventas')
            ultima_venta = cur.fetchone()[0]
            cur.execute('SELECT MAX(fecha_hora)::date FROM compras')
            ultima_compra = cur.fetchone()[0]
            if ultima_venta and pd.Timestamp(ultima_venta) >= hasta:
                sys.exit(f'La base ya tiene ventas hasta {ultima_venta}. Usa una fecha posterior o --reemplazar.')
            desde_ventas = pd.Timestamp(ultima_venta) if ultima_venta else INICIO_DATOS - pd.Timedelta(days=1)
            desde_compras = pd.Timestamp(ultima_compra) if ultima_compra else INICIO_DATOS - pd.Timedelta(days=1)
            print(f'Carga incremental: ventas desde {(desde_ventas + pd.Timedelta(days=1)).date()} '
                  f'hasta {hasta.date()}')

        n_ventas, n_compras = cargar_transacciones(cur, d, prod_ids, prov_ids, id_usuario,
                                                   desde_ventas, desde_compras)
        print(f'  VENTAS: {n_ventas:,} · COMPRAS: {n_compras:,}')

        if not primera_carga:
            stock = stock_al_cierre(d, hasta)
            precios = precio_vigente(d)
            for p, id_p in prod_ids.items():
                cur.execute('UPDATE productos SET stock_actual = %s, precio_venta_clp = %s WHERE id_producto = %s',
                            (float(stock.get(p, 0)), int(precios[p]), id_p))
        print(f'  stock_actual y precio_venta_clp actualizados al {hasta.date()}')
        if not args.sin_predicciones:
            generar_predicciones(cur, hasta)

    # El backend proyecta la semana en curso (lunes de «hoy»): con datos hasta un domingo, «hoy» es el lunes siguiente
    print(f'Listo en {time.perf_counter() - inicio:.1f} s. Fecha de referencia para el backend: '
          f'FECHA_REFERENCIA={(hasta + pd.Timedelta(days=1)).date()}')


if __name__ == '__main__':
    main()
