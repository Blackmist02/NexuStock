"""Motor de predicción de demanda de NexuStock (CU-08).

Modos de uso:

    python predict.py <producto_id|todos> <semana|mes> < solicitud.json
        Una predicción por invocación. Responde un JSON por la salida estándar.

    python predict.py --servidor
        Proceso persistente para el backend (PyPredictorAdapter). Carga el modelo una vez,
        responde {"listo": true} y luego atiende una solicitud JSON por línea.

Solicitud (entrada estándar):

    {
      "fecha_objetivo": "2024-06-10",
      "eventos": [{"fecha": "2024-06-20", "nombre": "Día de los Pueblos Indígenas", "tipo": "feriado"}],
      "productos": [
        {"producto_id": 1, "categoria": "Vacuno",
         "ventas_semanales": [{"semana": "2024-04-15", "kg": 35.2}],
         "dias_quiebre_semana_anterior": 0}
      ]
    }

    - fecha_objetivo: cualquier día de la semana a predecir; se usa su lunes.
    - eventos: filas de EVENTOS_CALENDARIO desde fecha_objetivo hasta 5 semanas después.
    - ventas_semanales: kg por semana (lunes) de al menos las 8 semanas previas; las semanas
      sin venta pueden omitirse y cuentan como 0.
    - dias_quiebre_semana_anterior: opcional, 0 por defecto.
    - En modo --servidor, cada línea agrega "producto" y "horizonte" a la solicitud.
"""
import json
import os
import sys
import time

INICIO = time.perf_counter()

from datetime import date, timedelta
from pathlib import Path

import joblib
import pandas as pd

RUTA_MODELO = Path(os.environ.get('NEXUSTOCK_MODELO',
                                  Path(__file__).resolve().parent / 'models' / 'demanda_rf_v1.0.0.joblib'))
INICIO_SERIE = date(2022, 1, 3)   # lunes de la semana t = 0 en el entrenamiento
SEMANAS_HISTORIAL = 8
SEMANAS_MES = 4
DIAS_MES = 30
FERIADOS_IRRENUNCIABLES = {(1, 1), (5, 1), (9, 18), (9, 19), (12, 25)}


class ErrorSolicitud(Exception):
    pass


def lunes(d):
    return d - timedelta(days=d.weekday())


def dias_hasta_18(semana):
    dieciocho = date(semana.year, 9, 18)
    if semana > dieciocho:
        dieciocho = date(semana.year + 1, 9, 18)
    return (dieciocho - semana).days


def local_cerrado(dia, eventos_dia):
    """Feriados irrenunciables (Ley 19.973) y jornadas electorales."""
    if (dia.month, dia.day) in FERIADOS_IRRENUNCIABLES:
        return True
    return any(e['nombre'].startswith(('Elecci', 'Plebiscito')) for e in eventos_dia)


def variables_calendario(semana, eventos_por_dia):
    """Mismas variables de calendario que el notebook 02, a partir de EVENTOS_CALENDARIO."""
    v = dict.fromkeys(['dias_cerrado', 'feriado_largo', 'fiestas_patrias', 'semana_santa',
                       'cuaresma', 'evento_especial', 'quincena', 'fin_mes'], 0)
    for i in range(7):
        dia = semana + timedelta(days=i)
        evs = eventos_por_dia.get(dia, [])
        nombres = [e['nombre'] for e in evs]
        v['dias_cerrado'] += local_cerrado(dia, evs)
        v['feriado_largo'] |= any(e['tipo'] == 'feriado_largo' for e in evs)
        v['fiestas_patrias'] |= any(n.startswith('Fiestas Patrias') for n in nombres)
        v['semana_santa'] |= any(s in n for n in nombres
                                 for s in ('Semana Santa', 'Viernes Santo', 'Sábado Santo'))
        v['cuaresma'] |= any(n.startswith('Cuaresma') for n in nombres)
        v['evento_especial'] |= any(e['tipo'] == 'otro' and not e['nombre'].startswith('Cierre Paso')
                                    for e in evs)
        v['quincena'] |= dia.day == 15
        v['fin_mes'] |= (dia + timedelta(days=1)).day == 1
    v = {k: int(x) for k, x in v.items()}
    v['dias_hasta_18'] = dias_hasta_18(semana)
    v['semana_anio'] = semana.isocalendar().week
    v['mes'] = (semana + timedelta(days=3)).month
    v['t'] = (semana - INICIO_SERIE).days // 7
    return v


def fila(categoria, semana, kg_por_semana, dias_quiebre_lag_1, eventos_por_dia):
    previas = [kg_por_semana.get(semana - timedelta(weeks=k), 0.0) for k in range(1, SEMANAS_HISTORIAL + 1)]
    return {
        'categoria': categoria,
        'lag_1': previas[0], 'lag_2': previas[1], 'lag_3': previas[2], 'lag_4': previas[3],
        'media_4': sum(previas[:4]) / 4,
        'media_8': sum(previas) / SEMANAS_HISTORIAL,
        **variables_calendario(semana, eventos_por_dia),
        'dias_quiebre_lag_1': dias_quiebre_lag_1,
    }


def leer_eventos(eventos):
    por_dia = {}
    for e in eventos:
        por_dia.setdefault(date.fromisoformat(e['fecha']), []).append(e)
    return por_dia


def predecir(solicitud, artefacto, horizonte='semana', producto='todos'):
    """Devuelve una lista de {producto_id, demanda_kg} o {producto_id, error}."""
    if horizonte not in ('semana', 'mes'):
        raise ErrorSolicitud(f"horizonte debe ser 'semana' o 'mes', no '{horizonte}'")
    try:
        semana = lunes(date.fromisoformat(solicitud['fecha_objetivo']))
        productos = solicitud['productos']
    except (KeyError, TypeError, ValueError) as e:
        raise ErrorSolicitud(f'solicitud inválida: {e}') from e

    if producto != 'todos':
        productos = [p for p in productos if str(p.get('producto_id')) == str(producto)]
        if not productos:
            raise ErrorSolicitud(f'el producto {producto} no viene en la solicitud')

    eventos_por_dia = leer_eventos(solicitud.get('eventos', []))
    modelo, variables = artefacto['modelo'], artefacto['variables']
    n_semanas = 1 if horizonte == 'semana' else SEMANAS_MES

    resultados, estados = [], []
    for p in productos:
        kg = {lunes(date.fromisoformat(v['semana'])): float(v['kg']) for v in p.get('ventas_semanales', [])}
        recientes = [kg.get(semana - timedelta(weeks=k), 0.0) for k in range(1, SEMANAS_HISTORIAL + 1)]
        if not any(recientes):
            resultados.append({'producto_id': p.get('producto_id'), 'error': 'historial_insuficiente'})
            continue
        tope = artefacto['topes_kg'].get(str(p['producto_id']), 1.5 * max(kg.values()))
        estado = {'p': p, 'kg': kg, 'tope': tope, 'total': 0.0,
                  'quiebre': p.get('dias_quiebre_semana_anterior', 0) or 0}
        estados.append(estado)
        resultados.append(estado)

    # Predicción recursiva: para el horizonte mensual, cada semana usa las predicciones anteriores como lags
    for k in range(n_semanas):
        objetivo = semana + timedelta(weeks=k)
        filas = [fila(e['p']['categoria'], objetivo, e['kg'], e['quiebre'], eventos_por_dia) for e in estados]
        if not filas:
            break
        preds = modelo.predict(pd.DataFrame(filas, columns=variables))
        for e, pred in zip(estados, preds):
            pred = min(max(float(pred), 0.0), e['tope'])
            e['kg'][objetivo] = pred
            e['total'] += pred
            e['quiebre'] = 0

    factor = 1 if horizonte == 'semana' else DIAS_MES / (7 * SEMANAS_MES)
    return [r if 'error' in r else {'producto_id': r['p']['producto_id'],
                                    'demanda_kg': round(r['total'] * factor, 2)}
            for r in resultados]


def cargar_modelo(ruta=RUTA_MODELO):
    artefacto = joblib.load(ruta)
    artefacto['modelo'].set_params(modelo__n_jobs=1)
    return artefacto


def mae_horizonte(artefacto, horizonte):
    """MAE semanal del modelo; para el mes se informa la cota superior (suma de 30 días de error)."""
    mae = artefacto['mae_general']
    return round(mae if horizonte == 'semana' else mae * DIAS_MES / 7, 3)


def responder(solicitud, artefacto, producto, horizonte, inicio):
    resultados = predecir(solicitud, artefacto, horizonte, producto)
    respuesta = {'mae': mae_horizonte(artefacto, horizonte), 'version': artefacto['version']}
    if producto == 'todos':
        respuesta['predicciones'] = resultados
    elif 'error' in resultados[0]:
        raise ErrorSolicitud(resultados[0]['error'])
    else:
        respuesta['demanda_kg'] = resultados[0]['demanda_kg']
    respuesta['latencia_ms'] = round((time.perf_counter() - inicio) * 1000)
    return respuesta


def escribir(objeto):
    sys.stdout.write(json.dumps(objeto, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def modo_servidor(artefacto):
    escribir({'listo': True, 'version': artefacto['version']})
    for linea in sys.stdin:
        if not linea.strip():
            continue
        inicio = time.perf_counter()
        try:
            solicitud = json.loads(linea)
            escribir(responder(solicitud, artefacto, solicitud.get('producto', 'todos'),
                               solicitud.get('horizonte', 'semana'), inicio))
        except (ErrorSolicitud, json.JSONDecodeError) as e:
            escribir({'error': str(e)})


def main(argv):
    if argv == ['--servidor']:
        modo_servidor(cargar_modelo())
        return 0
    if len(argv) != 2:
        escribir({'error': 'uso: predict.py <producto_id|todos> <semana|mes>  |  predict.py --servidor'})
        return 2
    try:
        solicitud = json.load(sys.stdin)
        escribir(responder(solicitud, cargar_modelo(), argv[0], argv[1], INICIO))
        return 0
    except (ErrorSolicitud, json.JSONDecodeError) as e:
        escribir({'error': str(e)})
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
