"""Valida predict.py contra los resultados del notebook 03.

1. Las variables de calendario calculadas desde EVENTOS_CALENDARIO (una fila por día)
   coinciden con las de semanal.csv.
2. Reproducir 2024 semana a semana con predict.py da las mismas predicciones del notebook.
3. La interfaz de línea de comandos y el modo --servidor responden según el contrato.

Uso (desde ml-engine):  python tests/validar_predict.py
"""
import json
import subprocess
import sys
import time
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
import predict  # noqa: E402

RAW = BASE / 'data' / 'raw'
PROCESSED = BASE / 'data' / 'processed'
PY = sys.executable


def eventos_formato_bd():
    """calendario_eventos.csv expandido a una fila por día, como EVENTOS_CALENDARIO."""
    cal = pd.read_csv(RAW / 'calendario_eventos.csv', parse_dates=['fecha_inicio', 'fecha_fin'])
    filas = []
    for _, e in cal.iterrows():
        for dia in pd.date_range(e['fecha_inicio'], e['fecha_fin'], freq='D'):
            filas.append({'fecha': dia.date().isoformat(), 'nombre': e['evento'], 'tipo': e['tipo']})
    return filas


eventos = eventos_formato_bd()
eventos_por_dia = predict.leer_eventos(eventos)
semanal = pd.read_csv(PROCESSED / 'semanal.csv', parse_dates=['semana'])
productos = pd.read_csv(RAW / 'productos.csv')

# ---- 1. Variables de calendario
columnas = ['dias_cerrado', 'feriado_largo', 'fiestas_patrias', 'semana_santa', 'cuaresma',
            'evento_especial', 'quincena', 'fin_mes', 'dias_hasta_18', 'semana_anio', 'mes', 't']
esperado = semanal.drop_duplicates('semana').set_index('semana')[columnas]
calculado = pd.DataFrame([predict.variables_calendario(s.date(), eventos_por_dia) for s in esperado.index],
                         index=esperado.index)[columnas]
diferencias = (esperado != calculado).sum()
assert diferencias.sum() == 0, f'variables de calendario distintas:\n{diferencias[diferencias > 0]}'
print(f'[1] Calendario: {len(esperado)} semanas idénticas a semanal.csv')

# ---- 2. Reproducción de 2024
ventas = pd.concat([pd.read_csv(f) for f in sorted(RAW.glob('20*/ventas_*.csv'))], ignore_index=True)
ventas['fecha'] = pd.to_datetime(ventas['fecha'])
ventas['semana'] = ventas['fecha'] - pd.to_timedelta(ventas['fecha'].dt.dayofweek, unit='D')
kg_semana = ventas.groupby(['producto_id', 'semana'])['cantidad_kg'].sum()
quiebres = semanal.set_index(['producto_id', 'semana'])['dias_quiebre']

artefacto = predict.cargar_modelo()
referencia = pd.read_csv(PROCESSED / 'predicciones_prueba_2024.csv', parse_dates=['semana'])


def solicitud_para(semana, con_quiebres=True):
    prods = []
    for _, p in productos.iterrows():
        hist = kg_semana.loc[p['producto_id']]
        hist = hist[(hist.index < semana) & (hist.index >= semana - timedelta(weeks=8))]
        prods.append({
            'producto_id': p['producto_id'],
            'categoria': p['categoria'],
            'ventas_semanales': [{'semana': s.date().isoformat(), 'kg': float(k)} for s, k in hist.items()],
            'dias_quiebre_semana_anterior':
                int(quiebres.get((p['producto_id'], semana - timedelta(weeks=1)), 0)) if con_quiebres else 0,
        })
    return {'fecha_objetivo': semana.date().isoformat(), 'eventos': eventos, 'productos': prods}


filas, filas_sin_quiebre = [], []
for semana in sorted(referencia['semana'].unique()):
    semana = pd.Timestamp(semana)
    for con, destino in ((True, filas), (False, filas_sin_quiebre)):
        for r in predict.predecir(solicitud_para(semana, con), artefacto, 'semana'):
            destino.append({'producto_id': r['producto_id'], 'semana': semana, 'pred': r['demanda_kg']})

comp = referencia.merge(pd.DataFrame(filas), on=['producto_id', 'semana'])
dif = (comp['pred'] - comp['pred_rf']).abs().max()
assert len(comp) == len(referencia) and dif < 0.006, f'diferencia máxima {dif}'
mae = (comp['kg'] - comp['pred']).abs().mean()
print(f'[2] 2024: {len(comp)} predicciones, diferencia máxima con el notebook {dif:.4f} kg, MAE {mae:.3f}')

sin_q = referencia.merge(pd.DataFrame(filas_sin_quiebre), on=['producto_id', 'semana'])
print(f'    Sin dias_quiebre_semana_anterior (valor 0): MAE {(sin_q["kg"] - sin_q["pred"]).abs().mean():.3f}')

# ---- 3. Línea de comandos y modo servidor
solicitud = solicitud_para(pd.Timestamp('2024-09-09'))
entrada = json.dumps(solicitud)

for args in (['P001', 'semana'], ['P001', 'mes'], ['todos', 'semana']):
    inicio = time.perf_counter()
    proc = subprocess.run([PY, str(BASE / 'predict.py'), *args], input=entrada,
                          capture_output=True, text=True, encoding='utf-8')
    total = (time.perf_counter() - inicio) * 1000
    resp = json.loads(proc.stdout)
    assert proc.returncode == 0, resp
    resumen = resp.get('demanda_kg', f"{len(resp.get('predicciones', []))} productos")
    print(f'[3] predict.py {" ".join(args):<13} -> {resumen} | mae {resp["mae"]} | '
          f'latencia_ms {resp["latencia_ms"]} | proceso completo {total:.0f} ms')

proc = subprocess.run([PY, str(BASE / 'predict.py'), 'P999', 'semana'], input=entrada,
                      capture_output=True, text=True, encoding='utf-8')
assert proc.returncode == 1 and 'error' in json.loads(proc.stdout)
print(f'    Producto inexistente -> código {proc.returncode}: {json.loads(proc.stdout)["error"]}')

servidor = subprocess.Popen([PY, str(BASE / 'predict.py'), '--servidor'], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, text=True, encoding='utf-8')
inicio = time.perf_counter()
listo = json.loads(servidor.stdout.readline())
print(f'[3] Servidor listo en {(time.perf_counter() - inicio) * 1000:.0f} ms: {listo}')
latencias = []
for horizonte in ['semana'] * 5 + ['mes'] * 5:
    inicio = time.perf_counter()
    servidor.stdin.write(json.dumps({**solicitud, 'producto': 'todos', 'horizonte': horizonte}) + '\n')
    servidor.stdin.flush()
    resp = json.loads(servidor.stdout.readline())
    latencias.append((time.perf_counter() - inicio) * 1000)
    assert len(resp['predicciones']) == 24
servidor.stdin.write('esto no es json\n')
servidor.stdin.flush()
print('    Solicitud inválida ->', json.loads(servidor.stdout.readline()))
servidor.stdin.close()
servidor.wait(timeout=5)
print(f'    24 productos por solicitud: semana {np.mean(latencias[:5]):.0f} ms, mes {np.mean(latencias[5:]):.0f} ms')
print('Resultado: OK')
