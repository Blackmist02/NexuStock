# ml-engine — motor predictivo (equipo de datos)

Esta carpeta la llena el equipo de ciencia de datos; el backend solo la **lee** (en Docker se monta como `/ml-engine`, solo lectura).

```
ml-engine/
  predict.py            ← tu script (lo invoca el backend). Ver predict.example.py para el contrato.
  models/               ← artefactos del modelo (.joblib, .pkl…)
  predict.example.py    ← ejemplo mínimo del contrato (no es un modelo real)
```

## Cómo se usa

1. Copia `predict.py` y el artefacto (p. ej. `models/rf_v1.joblib`) aquí.
2. Si el script necesita librerías, habilita Python en la imagen del backend: en `.env` pon `WITH_PYTHON=true` y
   `ML_PIP_PACKAGES=scikit-learn joblib pandas`, y reconstruye (`docker compose build backend`).
3. En NexuStock, con un usuario **TI**: *Predicción → Precisión del modelo → Registrar versión* (algoritmo, versión, MAE, fechas
   de entrenamiento y prueba, ruta `models/rf_v1.joblib`) y luego *Activar*. Solo hay un modelo activo.

## Contrato

El backend ejecuta `python3 predict.py <id_producto> <semana|mes>` como proceso hijo, entrega un JSON por **stdin** y lee un JSON por **stdout**:

```jsonc
// stdin
{ "producto": { "id_producto": 3, "nombre": "Lomo vetado", "unidad": "kg", "categoria": "Vacuno" },
  "horizonte": "semana",                    // "semana" | "mes"
  "fecha_objetivo": "2026-10-12",           // lunes de la semana en curso o primer día del mes
  "artefacto": "/ml-engine/models/rf_v1.joblib",
  "ventas":  [{ "fecha": "2026-10-01", "cantidad": 12.5 }],   // últimos 120 días, cantidad diaria
  "eventos": [{ "fecha": "2026-10-12", "nombre": "Encuentro de Dos Mundos", "tipo": "feriado" }] }

// stdout
{ "demanda_kg": 84.2, "mae": 3.6, "latencia_ms": 120 }
```

## Reglas que aplica el backend

- **Límite de 2 segundos** (`ML_TIMEOUT_MS`): si el script tarda más, falla o devuelve algo inválido (no numérico, negativo o sobre
  `CAPACIDAD_KG_SEMANA`), esa proyección usa el **promedio histórico** del producto (o el de su categoría si no tiene ventas) y se
  marca como tal. El usuario nunca ve el error técnico (RF-11).
- Cada predicción se registra en `PREDICCIONES` con su origen (`modelo` / `promedio_historico` / `categoria`) y su latencia (RF-10).
- Las predicciones con el modelo se reutilizan durante el día; se recalculan al cambiar el modelo activo o con *Recalcular*.
- El artefacto debe estar dentro de esta carpeta (no se aceptan rutas con `..`).
