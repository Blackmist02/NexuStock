INSERT INTO MODELOS_ML (algoritmo, version, mae_general, mae_festivos,
                        entrenado_desde, entrenado_hasta, prueba_desde, prueba_hasta,
                        artefacto_ruta, activo)
VALUES ('RandomForestRegressor', '1.1.0', 5.237, 8.933,
        '2022-02-28', '2023-12-31', '2024-01-01', '2024-12-29',
        'models/demanda_rf_v1.1.0.joblib', TRUE);
