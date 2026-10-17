"""
Ejemplo mínimo del contrato del motor predictivo de NexuStock (NO es un modelo real).

El backend ejecuta:  python3 predict.py <id_producto> <semana|mes>
Entrega por stdin un JSON:
  {
    "producto":       {"id_producto": 3, "nombre": "Lomo vetado", "unidad": "kg", "categoria": "Vacuno"},
    "horizonte":      "semana" | "mes",
    "fecha_objetivo": "2026-10-12",              # lunes de la semana o primer día del mes
    "artefacto":      "/ml-engine/models/rf_v1.joblib",   # ruta absoluta del modelo activo
    "ventas":         [{"fecha": "2026-10-01", "cantidad": 12.5}, ...],   # cantidad diaria vendida
    "eventos":        [{"fecha": "2026-10-12", "nombre": "Encuentro de Dos Mundos", "tipo": "feriado"}, ...]
  }
y espera por stdout UN JSON:  {"demanda_kg": 84.2, "mae": 3.6, "latencia_ms": 120}

Si el script falla, no responde un JSON válido o tarda más de 2 s, el sistema usa el promedio histórico.
Para usar un modelo real: copia tu predict.py a esta carpeta (ml-engine/predict.py), deja los .joblib en models/ y
regístralos en NexuStock → Predicción → Precisión del modelo (rol TI).
"""
import json
import sys

datos = json.load(sys.stdin)
ventas = datos["ventas"][-14:]
promedio_diario = sum(v["cantidad"] for v in ventas) / max(1, len(ventas))
dias = 7 if datos["horizonte"] == "semana" else 30
print(json.dumps({"demanda_kg": round(promedio_diario * dias * 1.05, 2), "mae": 3.6, "latencia_ms": 1}))
