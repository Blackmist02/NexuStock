"""Convierte las ventas, compras y mermas de data/raw al formato de las plantillas de carga de la plataforma.

Uso (desde ml-engine, con el .venv activo):

    python exportar_plantillas.py                                  # todo 2024
    python exportar_plantillas.py --desde 2024-09-30 --hasta 2024-12-31

Escribe data/plantillas/{ventas,compras,mermas}_<desde>_<hasta>.csv con separador «;» y coma decimal (como Excel en
español), con el nombre del producto y del proveedor en lugar de sus códigos. Esos archivos se suben en
Configuración → Carga de datos: la plataforma importa solo lo posterior a lo ya cargado y hasta la fecha límite que
se elija, así que se puede subir el archivo completo cada semana.
"""
import argparse
from pathlib import Path

import pandas as pd

BASE = Path(__file__).resolve().parent
RAW = BASE / 'data' / 'raw'
SALIDA = BASE / 'data' / 'plantillas'


def leer(patron):
    return pd.concat([pd.read_csv(f) for f in sorted(RAW.glob(patron))], ignore_index=True)


def escribir(df, ruta):
    # Coma decimal y separador «;»; BOM para que Excel reconozca los acentos
    df.to_csv(ruta, sep=';', decimal=',', index=False, encoding='utf-8-sig', lineterminator='\r\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--desde', default='2024-01-01', help='primer día (AAAA-MM-DD)')
    ap.add_argument('--hasta', default='2024-12-31', help='último día (AAAA-MM-DD)')
    args = ap.parse_args()
    desde, hasta = pd.Timestamp(args.desde), pd.Timestamp(args.hasta)

    productos = pd.read_csv(RAW / 'productos.csv').set_index('producto_id')['nombre_producto']
    proveedores = pd.read_csv(RAW / 'proveedores.csv').set_index('proveedor_id')['nombre_proveedor']
    SALIDA.mkdir(parents=True, exist_ok=True)
    sufijo = f'{desde.date()}_{hasta.date()}'

    v = leer('20*/ventas_*.csv')
    v['fecha'] = pd.to_datetime(v['fecha'])
    v = v[v['fecha'].between(desde, hasta)].sort_values(['fecha', 'hora'])
    ventas = pd.DataFrame({
        'fecha': v['fecha'].dt.strftime('%Y-%m-%d'), 'hora': v['hora'], 'producto': v['producto_id'].map(productos),
        'cantidad': v['cantidad_kg'], 'precio_unitario_clp': v['precio_unitario_venta_clp']})

    c = leer('20*/compras_*.csv')
    c['fecha_recepcion'] = pd.to_datetime(c['fecha_recepcion'])
    c = c[c['fecha_recepcion'].between(desde, hasta)].sort_values('fecha_recepcion')
    compras = pd.DataFrame({
        'fecha': c['fecha_recepcion'].dt.strftime('%Y-%m-%d'), 'hora': '08:00', 'producto': c['producto_id'].map(productos),
        'cantidad': c['cantidad_kg'], 'costo_unitario_clp': c['precio_unitario_compra_clp'],
        'proveedor': c['proveedor_id'].map(proveedores)})

    m = leer('20*/mermas_*.csv')
    m['fecha'] = pd.to_datetime(m['fecha'])
    m = m[m['fecha'].between(desde, hasta)].sort_values('fecha')
    mermas = pd.DataFrame({
        'fecha': m['fecha'].dt.strftime('%Y-%m-%d'), 'hora': '20:00', 'producto': m['producto_id'].map(productos),
        'cantidad': m['cantidad_kg'], 'motivo': m['motivo'], 'costo_unitario_clp': m['costo_unitario_clp']})

    for nombre, df in (('ventas', ventas), ('compras', compras), ('mermas', mermas)):
        assert df['producto'].notna().all(), f'{nombre}: hay productos sin nombre en productos.csv'
        ruta = SALIDA / f'{nombre}_{sufijo}.csv'
        escribir(df, ruta)
        print(f'{ruta.relative_to(BASE)}: {len(df):,} filas')


if __name__ == '__main__':
    main()
