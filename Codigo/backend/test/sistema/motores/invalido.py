# Motor de prueba (tarea 28): responde a tiempo pero con valores no viables (negativo, fuera de la capacidad del
# local y no numérico). La API debe descartarlos y aplicar el respaldo (CU-08 6a, RNF-15).
import json
import sys

print(json.dumps({"listo": True, "version": "qa-invalido"}), flush=True)
valores = [-50, 99999999, "NaN"]
for linea in sys.stdin:
    req = json.loads(linea)
    preds = [{"producto_id": p["producto_id"], "demanda_kg": valores[i % 3]} for i, p in enumerate(req.get("productos", []))]
    print(json.dumps({"predicciones": preds, "mae": 1, "latencia_ms": 5, "version": "qa-invalido"}), flush=True)
