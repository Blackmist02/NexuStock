# ml-engine — motor predictivo

Modelo de demanda semanal por producto (Random Forest) y su integración con el backend. El backend solo **lee** esta
carpeta (en Docker se monta como `/ml-engine`, solo lectura).

```
ml-engine/
  predict.py               ← motor de predicción (lo usa el backend como proceso hijo)
  models/                  ← modelo serializado (demanda_rf_v1.0.0.joblib) y su fila para MODELOS_ML
  notebooks/               ← 01 EDA · 02 variables · 03 modelado y evaluación
  data/raw/                ← ventas, compras, mermas, catálogo, proveedores y calendario 2022-2024
  data/processed/          ← datasets que producen los notebooks
  data/evaluacion/         ← demanda total y venta perdida por día (solo evaluación, nunca variable del modelo)
  tests/validar_predict.py ← comprueba que predict.py reproduce las predicciones del notebook 03
  crear_esquema.py         ← crea el esquema (init.sql) en una base vacía (local, Supabase o proveedor definitivo)
  cargar_bd.py             ← carga los datos hasta una fecha y registra las predicciones semanales de 2024
```

Entorno: Python 3.12 y las versiones de `requirements.txt` (scikit-learn va fijo: debe coincidir con el del modelo).
Para los notebooks y los scripts de carga: `pip install -r requirements-dev.txt`.

## Cómo lo usa el backend

1. Al iniciar, el backend lanza `python3 predict.py --servidor` con el artefacto del **modelo activo** de `MODELOS_ML`
   (variable `NEXUSTOCK_MODELO`). El proceso carga el modelo una vez (3-5 s) y responde `{"listo": true}`.
2. Cada predicción es una línea JSON por la entrada estándar y una línea JSON de respuesta (~50 ms para 24 productos).
3. Si el motor no está listo, falla, tarda más de 2 s (`ML_TIMEOUT_MS`) o devuelve un valor no viable (negativo o sobre
   `CAPACIDAD_KG_SEMANA`), esa proyección usa el **promedio histórico** del producto o el de su categoría (RF-11).
4. Si se activa otro modelo, el proceso se reinicia con su artefacto.

El modelo se registra en NexuStock → *Predicción → Precisión del modelo* (rol TI) con la ruta `models/demanda_rf_v1.0.0.joblib`
(relativa a esta carpeta), o con `models/registro_modelos_ml.sql`.

## Contrato

```jsonc
// solicitud (una línea)
{ "fecha_objetivo": "2024-09-30",          // lunes de la semana a proyectar
  "producto": "todos", "horizonte": "semana",   // "semana" | "mes"
  "eventos":   [{ "fecha": "2024-10-12", "nombre": "Encuentro de Dos Mundos", "tipo": "feriado" }],
  "productos": [{ "producto_id": 3, "categoria": "Vacuno",
                  "ventas_semanales": [{ "semana": "2024-09-23", "kg": 35.2 }] }] }   // 8 semanas previas

// respuesta (una línea)
{ "predicciones": [{ "producto_id": 3, "demanda_kg": 38.13 }], "mae": 5.144, "latencia_ms": 46, "version": "1.0.0" }
```

Un producto sin ventas en las 8 semanas previas responde `{ "producto_id": …, "error": "historial_insuficiente" }` y el
backend usa el promedio de su categoría. También se puede usar sin el backend:
`python predict.py <producto_id|todos> <semana|mes> < solicitud.json`.

## Validación

```powershell
python tests\validar_predict.py      # debe terminar en "Resultado: OK"
```
