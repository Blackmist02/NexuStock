# Motor de prueba (tarea 28): anuncia que está listo y se cae con un error al recibir la primera solicitud (CU-08 5a).
import json
import sys

print(json.dumps({"listo": True, "version": "qa-caido"}), flush=True)
for linea in sys.stdin:
    sys.stderr.write("Traceback (most recent call last):\n  File \"/ml-engine/predict.py\", line 1\nMemoryError: falla simulada\n")
    sys.exit(1)
