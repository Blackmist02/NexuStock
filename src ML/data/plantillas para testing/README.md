# Plantillas para testing

Archivos CSV listos para probar la carga de datos de NexuStock (*Configuración → Carga de datos (CSV)*), en el mismo
formato que las plantillas que descarga la plataforma: separador `;` y coma decimal, como los guarda Excel. Son los
datos reales 2024 de la carnicería piloto (El Buen Pastor), generados con `src ML/exportar_plantillas.py`.

| Archivo | Periodo | Filas | Para qué sirve |
| --- | --- | ---: | --- |
| `ventas_2024-09-23_2024-09-29.csv` | 23 al 29-09-2024 | 617 | Prueba rápida de una semana (la del README). |
| `compras_2024-09-23_2024-09-29.csv` | 23 al 29-09-2024 | 57 | |
| `mermas_2024-09-23_2024-09-29.csv` | 23 al 29-09-2024 | 12 | |
| `ventas_2024-01-01_2024-09-29.csv` | 01-01 al 29-09-2024 | 26.589 | Recargar cualquier tramo de 2024 (por ejemplo, después de deshacer desde una fecha anterior al 23-09). |
| `compras_2024-01-01_2024-09-29.csv` | 01-01 al 29-09-2024 | 2.372 | |
| `mermas_2024-01-01_2024-09-29.csv` | 01-01 al 29-09-2024 | 510 | |

## Regla para repetir una prueba

La plataforma importa solo lo **posterior a lo ya cargado** y hasta la fecha límite elegida, así que subir un archivo
completo no duplica nada. Lo que sí importa es que **los archivos cubran desde el día siguiente a lo cargado**:

- *Deshacer movimientos desde* **23/09/2024** → sirven las plantillas de la **semana**.
- *Deshacer* desde **cualquier fecha anterior** → usar las del **año completo** (las de la semana dejarían un hueco de días
  sin compras ni ventas, y la revisión lo avisa con «Faltan movimientos…» y errores de stock insuficiente).

Para probar el filtro por tramos, sube las del año y carga primero hasta una fecha intermedia (por ejemplo 25/09) y
después hasta el 29/09: la columna «Ya cargadas» muestra lo que se omite y nada se importa dos veces.

Las fechas del 01-01-2024 y del 01-09-2024 tienen saldos levemente negativos en los datos originales (−0,1 / −0,17 kg por
el pesaje). Si se deshace desde esos días, la revisión lo avisa y el stock final puede diferir en esos gramos.
