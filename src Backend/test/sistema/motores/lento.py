# Motor de prueba (tarea 28): anuncia que está listo y tarda 5 s en cada respuesta (supera el límite de 2 s, RNF-01).
import json
import sys
import time

print(json.dumps({"listo": True, "version": "qa-lento"}), flush=True)
for linea in sys.stdin:
    time.sleep(5)
    req = json.loads(linea)
    preds = [{"producto_id": p["producto_id"], "demanda_kg": 10} for p in req.get("productos", [])]
    print(json.dumps({"predicciones": preds, "mae": 1, "latencia_ms": 5000, "version": "qa-lento"}), flush=True)
