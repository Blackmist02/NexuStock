"""Reconstruye la venta del 18 y 19 de septiembre (2022-2024) de Carnicería El Buen Pastor.

Contexto: los registros del local traen 0 ventas esos días y el proyecto los trataba como «local cerrado» por ser
feriados irrenunciables (Ley 19.973). El cliente confirmó (2026-11-15) que el local SÍ abrió: es una carnicería de barrio
atendida por la familia, sin trabajadores dependientes, a quienes no alcanza la obligación de cerrar. Mientras llegan
los registros reales de esas fechas, este script los reconstruye con el patrón del propio local:

1. Demanda del día: demanda media diaria del local entre el 12 y el 17 de septiembre del mismo año (semana de Fiestas
   Patrias) × 0,85 el 18 y × 0,55 el 19, repartida según la participación de cada producto en esa misma semana, con
   ruido lognormal (σ = 0,15). Los supermercados cierran esos días, así que el local recibe compras de última hora.
2. Venta = mín(demanda, stock disponible); lo que falta es venta perdida (quiebre) y queda en
   evaluacion/demanda_diaria.csv.
3. Tickets: tamaños de línea tomados de las ventas reales del producto esa semana, horario reducido (9:00 a 14:59),
   1,65 líneas por ticket, medio de pago y cliente según la distribución real.
4. La cadena de stock posterior no cambia: lo vendido de más reduce primero las mermas por vencimiento de los días
   siguientes (ese producto ya no alcanzó a vencer) y el resto se repone el 20 con un distribuidor nacional.

Todo lo agregado lleva prefijo propio (VTR, TKR, CPR, F-R) y cada cambio queda en
data/raw/reconstruccion_fiestas_patrias.csv. Las filas reales no se modifican, salvo las mermas reducidas (registradas
en la bitácora con su valor original). Si llegan los registros reales: `git checkout` de los archivos y cargarlos.

Uso: python reconstruir_fiestas_patrias.py            (aborta si ya se aplicó)
"""

import csv
import io
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

BASE = Path(__file__).resolve().parent
RAW = BASE / 'data' / 'raw'
EVAL = BASE / 'data' / 'evaluacion' / 'demanda_diaria.csv'
BITACORA = RAW / 'reconstruccion_fiestas_patrias.csv'
CALENDARIO = RAW / 'calendario_eventos.csv'

ANIOS = (2022, 2023, 2024)
FACTOR_DIA = {18: 0.85, 19: 0.55}
SIGMA = 0.15
LINEAS_POR_TICKET = 1.65
HORAS = list(range(9, 15))
SEMILLA = 1809
EFECTO_ABIERTO = ('Local abierto (atendido por la familia; el feriado irrenunciable no lo obliga a cerrar). '
                  'Compras de última hora para asado: los supermercados cierran')


# ---------------------------------------------------------------- utilidades de texto (las filas reales no se tocan)
def leer(ruta):
    texto = ruta.read_bytes().decode('utf-8-sig')
    lineas = texto.split('\r\n')
    if lineas[-1] == '':
        lineas.pop()
    return lineas


def escribir(ruta, lineas):
    ruta.write_bytes(('﻿' + '\r\n'.join(lineas) + '\r\n').encode('utf-8'))


def fila(valores):
    buf = io.StringIO()
    csv.writer(buf, lineterminator='').writerow(valores)
    return buf.getvalue()


def campos(linea):
    return next(csv.reader([linea]))


def num(x):
    return repr(round(float(x), 2))


# ---------------------------------------------------------------- datos
def cargar():
    ventas = {a: pd.read_csv(RAW / str(a) / f'ventas_{a}.csv', parse_dates=['fecha']) for a in ANIOS}
    compras = {a: pd.read_csv(RAW / str(a) / f'compras_{a}.csv', parse_dates=['fecha_pedido', 'fecha_recepcion'])
               for a in ANIOS}
    mermas = {a: pd.read_csv(RAW / str(a) / f'mermas_{a}.csv', parse_dates=['fecha']) for a in ANIOS}
    productos = pd.read_csv(RAW / 'productos.csv').set_index('producto_id')
    proveedores = pd.read_csv(RAW / 'proveedores.csv').set_index('proveedor_id')
    inventario = pd.read_csv(RAW / 'inventario_inicial_2022-01-01.csv', parse_dates=['fecha_recepcion'])
    demanda = pd.read_csv(EVAL, parse_dates=['fecha'])
    return ventas, compras, mermas, productos, proveedores, inventario, demanda


def serie_stock(ventas, compras, mermas, inventario):
    """Stock al cierre por producto y día, igual que el notebook 01 (entradas − ventas − mermas, acumulado)."""
    fechas = pd.date_range('2022-01-01', '2024-12-31', freq='D')
    inv = inventario.assign(fecha=inventario['fecha_recepcion'].clip(lower=fechas[0]))
    entradas = pd.concat([pd.concat(compras.values()).rename(columns={'fecha_recepcion': 'fecha'}),
                          inv])[['producto_id', 'fecha', 'cantidad_kg']]
    mov = (entradas.groupby(['producto_id', 'fecha'])['cantidad_kg'].sum()
           .sub(pd.concat(ventas.values()).groupby(['producto_id', 'fecha'])['cantidad_kg'].sum(), fill_value=0)
           .sub(pd.concat(mermas.values()).groupby(['producto_id', 'fecha'])['cantidad_kg'].sum(), fill_value=0))
    mov = mov.unstack('producto_id').reindex(fechas).fillna(0)
    return mov.cumsum()


def proveedor_nacional(categoria, proveedores):
    nac = proveedores[(proveedores['pais_origen'] == 'Chile') & proveedores['activo']]
    nac = nac[nac['categorias_suministradas'].str.contains(categoria)].sort_values('lead_time_dias')
    return nac.index[0]


# ---------------------------------------------------------------- reconstrucción
def main():
    ventas, compras, mermas, productos, proveedores, inventario, demanda = cargar()
    if any(v['venta_id'].str.startswith('VTR').any() for v in ventas.values()):
        raise SystemExit('La reconstrucción ya está aplicada (hay ventas VTR). Para regenerarla: git checkout de data/.')

    rng = np.random.default_rng(SEMILLA)
    stock_antes = serie_stock(ventas, compras, mermas, inventario)
    todas = pd.concat(ventas.values())
    p_pago = todas['medio_pago'].value_counts(normalize=True)
    p_cliente = todas['cliente_id'].value_counts(normalize=True)

    bitacora = []
    nuevas_ventas = defaultdict(list)       # año -> filas
    nuevas_compras = defaultdict(list)
    cambios_merma = {}                      # merma_id -> nueva cantidad (None = eliminar)
    dem_dia = {}                            # (fecha, producto) -> (latente, vendido, perdida)
    ajuste_stock = defaultdict(float)       # (producto, fecha desde) -> delta acumulado
    n_venta = n_ticket = n_compra = 0

    for anio in ANIOS:
        semana = demanda[(demanda['fecha'] >= f'{anio}-09-12') & (demanda['fecha'] <= f'{anio}-09-17')]
        media_dia = semana.groupby('fecha')['demanda_latente_kg'].sum().mean()
        participacion = semana.groupby('producto_id')['demanda_latente_kg'].sum()
        participacion /= participacion.sum()
        v_semana = ventas[anio][(ventas[anio]['fecha'] >= f'{anio}-09-10') & (ventas[anio]['fecha'] <= f'{anio}-09-17')]
        precio = (ventas[anio][ventas[anio]['fecha'] <= f'{anio}-09-17'].sort_values(['fecha', 'hora'])
                  .groupby('producto_id')['precio_unitario_venta_clp'].last())

        for dia in (18, 19):
            fecha = pd.Timestamp(anio, 9, dia)
            lineas = []
            for p in productos.index:
                disponible = max(0.0, stock_antes.at[fecha - timedelta(days=1), p] - ajuste_stock[(p, anio)])
                latente = round(float(media_dia * FACTOR_DIA[dia] * participacion.get(p, 0)
                                      * rng.lognormal(-SIGMA ** 2 / 2, SIGMA)), 2)
                # líneas de venta con los tamaños reales del producto esa semana
                tam = v_semana.loc[v_semana['producto_id'] == p, 'cantidad_kg'].to_numpy()
                resto = round(min(latente, disponible), 2)
                vendido = 0.0
                while resto > 0.05:
                    q = min(resto, float(rng.choice(tam)) if len(tam) else resto)
                    q = round(q if resto - q > 0.05 else resto, 2)
                    lineas.append((p, q))
                    resto = round(resto - q, 2)
                    vendido = round(vendido + q, 2)
                ajuste_stock[(p, anio)] += vendido
                dem_dia[(fecha, p)] = (latente, vendido, round(latente - vendido, 2))
                bitacora.append(['demanda', '', fecha.date(), p, '', num(latente),
                                 f'vendido {num(vendido)} kg; venta perdida {num(latente - vendido)} kg; '
                                 f'stock al abrir {num(disponible)} kg'])

            # agrupar en tickets y asignar hora, cliente y medio de pago
            orden = rng.permutation(len(lineas))
            n_tickets = max(1, round(len(lineas) / LINEAS_POR_TICKET))
            ticket_de = np.sort(rng.integers(0, n_tickets, len(lineas)))
            horas = sorted(f'{h:02d}:{m:02d}' for h, m in zip(rng.choice(HORAS, n_tickets), rng.integers(0, 60, n_tickets)))
            tickets = {}
            for k, i in zip(ticket_de, orden):
                if k not in tickets:
                    n_ticket += 1
                    tickets[k] = (f'TKR{n_ticket:06d}', horas[k], rng.choice(p_cliente.index, p=p_cliente.values),
                                  rng.choice(p_pago.index, p=p_pago.values))
                tk, hora, cliente, pago = tickets[k]
                p, q = lineas[i]
                n_venta += 1
                pu = int(precio[p])
                nuevas_ventas[anio].append((hora, [f'VTR{n_venta:06d}', tk, fecha.date(), hora, cliente, p, num(q),
                                                   pu, round(q * pu), pago]))

        # la cadena de stock posterior queda igual: menos merma por vencimiento y reposición el 20
        for p in productos.index:
            extra = round(ajuste_stock[(p, anio)], 2)
            if extra <= 0:
                continue
            vida = int(productos.at[p, 'vida_util_dias'])
            m = mermas[anio]
            candidatas = m[(m['producto_id'] == p) & (m['motivo'] == 'vencimiento')
                           & (m['fecha'] >= f'{anio}-09-20') & (m['fecha'] <= pd.Timestamp(anio, 9, 19) + timedelta(days=vida))]
            pendiente = extra
            reducido = 0.0
            for r in candidatas.itertuples():
                if pendiente <= 0.005:
                    break
                # Solo es «el mismo producto que habría vencido» si el stock original no bajó de lo ya reducido entre
                # el 20 y esa merma; si se agotó y se repuso, la merma es de mercadería nueva y se mantiene.
                piso = stock_antes.loc[f'{anio}-09-20':r.fecha - timedelta(days=1), p].min()
                baja = round(min(pendiente, r.cantidad_kg, max(0.0, piso - reducido)), 2)
                if baja <= 0.005:
                    continue
                nueva = round(r.cantidad_kg - baja, 2)
                cambios_merma[r.merma_id] = nueva if nueva > 0.005 else None
                pendiente = round(pendiente - baja, 2)
                reducido += baja
                bitacora.append(['merma_reducida' if nueva > 0.005 else 'merma_eliminada', r.merma_id, r.fecha.date(), p,
                                 num(r.cantidad_kg), num(nueva), 'producto vendido el 18-19 antes de vencer'])
            # reposición el 20: lo vendido de más que no salió de mermas futuras (la cadena posterior queda igual)
            reposicion = pendiente
            if reposicion > 0.005:
                prov = proveedor_nacional(productos.at[p, 'categoria'], proveedores)
                ultima = compras[anio][compras[anio]['producto_id'] == p].sort_values('fecha_recepcion')
                ultima = ultima[ultima['fecha_recepcion'] <= f'{anio}-09-17'].iloc[-1]
                costo = int(ultima['precio_unitario_compra_clp'])
                n_compra += 1
                nuevas_compras[anio].append([f'CPR{n_compra:06d}', date(anio, 9, 19), date(anio, 9, 20), 1, prov, 'Chile',
                                             'Terrestre nacional', p, num(reposicion), 'CLP', '', costo,
                                             round(reposicion * costo), 'False', f'F-R{n_compra:04d}', 'Crédito 30 días'])
                bitacora.append(['compra_reposicion', f'CPR{n_compra:06d}', date(anio, 9, 20), p, '', num(reposicion),
                                 f'reposición post-feriado con {prov}'])

    # ------------------------------------------------------------ escritura (texto: las filas reales quedan iguales)
    for anio in ANIOS:
        ruta = RAW / str(anio) / f'ventas_{anio}.csv'
        lineas = leer(ruta)
        corte = max(i for i, l in enumerate(lineas[1:], 1) if campos(l)[2] <= f'{anio}-09-17') + 1
        nuevas = [fila(f) for _, f in sorted(nuevas_ventas[anio], key=lambda x: (str(x[1][2]), x[0], x[1][0]))]
        escribir(ruta, lineas[:corte] + nuevas + lineas[corte:])

        ruta = RAW / str(anio) / f'compras_{anio}.csv'
        lineas = leer(ruta)
        corte = max(i for i, l in enumerate(lineas[1:], 1) if campos(l)[1] <= f'{anio}-09-19') + 1
        escribir(ruta, lineas[:corte] + [fila(f) for f in nuevas_compras[anio]] + lineas[corte:])

        ruta = RAW / str(anio) / f'mermas_{anio}.csv'
        salida = []
        for i, l in enumerate(leer(ruta)):
            c = campos(l)
            if i and c[0] in cambios_merma:
                nueva = cambios_merma[c[0]]
                if nueva is None:
                    continue
                c[3] = num(nueva)
                c[6] = round(nueva * int(c[5]))
                l = fila(c)
            salida.append(l)
        escribir(ruta, salida)

    # demanda_diaria: 18-19 reconstruidos y stock de cierre con la nueva cadena
    ventas2, compras2, mermas2, *_ = cargar()
    stock_despues = serie_stock(ventas2, compras2, mermas2, inventario)
    diferencia = (stock_despues - stock_antes).round(2)
    salida = []
    for i, l in enumerate(leer(EVAL)):
        c = campos(l)
        if i:
            f, p = pd.Timestamp(c[0]), c[1]
            if (f, p) in dem_dia:
                latente, vendido, perdida = dem_dia[(f, p)]
                c[2:5] = [num(latente), num(vendido), num(perdida)]
            d = diferencia.at[f, p]
            if d != 0:
                c[5] = num(max(0.0, float(c[5]) + d))
            l = fila(c)
        salida.append(l)
    escribir(EVAL, salida)

    # calendario: el 18 y 19 dejan de ser «Local cerrado»
    salida = []
    for i, l in enumerate(leer(CALENDARIO)):
        c = campos(l)
        if i and c[0] in ('Independencia Nacional', 'Glorias del Ejército') and 'Local cerrado' in c[4]:
            c[4] = EFECTO_ABIERTO
            l = fila(c)
        salida.append(l)
    escribir(CALENDARIO, salida)

    escribir(BITACORA, [fila(['tipo', 'id', 'fecha', 'producto_id', 'valor_original', 'valor_nuevo', 'detalle'])]
             + [fila(b) for b in bitacora])

    # ------------------------------------------------------------ verificación
    cola = diferencia.loc['2024-11-18':]
    print(f'Ventas agregadas: {n_venta} líneas en {n_ticket} tickets · reposiciones: {n_compra} · '
          f'mermas ajustadas: {len(cambios_merma)}')
    print(f'Stock mínimo antes {stock_antes.min().min():.2f} · después {stock_despues.min().min():.2f}')
    print('Desfase de stock al final de 2024 (debe ser 0):', float(cola.abs().max().max()))
    resumen = pd.DataFrame([(f.date(), p, *v) for (f, p), v in dem_dia.items()],
                           columns=['fecha', 'producto_id', 'demanda', 'vendido', 'perdida'])
    print(resumen.groupby('fecha')[['demanda', 'vendido', 'perdida']].sum().round(1).to_string())
    q = resumen[resumen['perdida'] > 0.05]
    print('Quiebres (venta perdida > 0):')
    print(q.assign(nombre=q['producto_id'].map(productos['nombre_producto'])).to_string(index=False))


if __name__ == '__main__':
    main()
