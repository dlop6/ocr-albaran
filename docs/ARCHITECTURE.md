# Arquitectura Modular - OCR Albarán

## Estructura de Directorios

```
src/
├── index.js                    # Entry point limpio (~30 líneas)
├── config/                     # Configuración centralizada
│   ├── env.js                 # Variables de entorno
│   ├── metrics.js             # Métricas Prometheus
│   └── middlewares.js         # Configuración de middlewares
├── routes/                     # Rutas Express
│   ├── index.js               # Agregador de rutas
│   ├── processRoutes.js       # POST /api/process-pdf
│   └── healthRoutes.js        # GET /health, /metrics
├── services/                   # Lógica de negocio
│   ├── ocrJobService.js       # Pipeline completo de OCR
│   └── bizagiService.js       # Callback a Bizagi
├── pdfService.js              # Conversión PDF → imágenes
├── ocrService.js              # OCR con Tesseract
├── parser.js                  # Filtrado de páginas relevantes
├── fieldExtractor.js          # Extracción de campos
├── concurrency.js             # Control de concurrencia
├── logger.js                  # Winston logger
└── utils/
    ├── isImageBlank.js        # Detección de páginas blancas
    └── extractContentRegion.js

## Módulos Principales

### 1. `config/env.js`
Centraliza todas las variables de entorno. Un solo lugar para cambiar defaults.

**Exports:**
- `PORT`, `HTTP_TIMEOUT_MS`
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`
- `ALLOWED_ORIGINS`
- `OCR_CONCURRENCY`, `OCR_DPI`
- `BIZAGI_BASE_URL`, `BIZAGI_TOKEN`

### 2. `config/metrics.js`
Define todas las métricas Prometheus.

**Exports:**
- `promClient` (para endpoint /metrics)
- `pdfProcessDuration`, `pageProcessDuration`
- `httpRequestCounter`, `httpRequestDuration`

### 3. `config/middlewares.js`
Configura y aplica todos los middlewares Express.

**Exports:**
- `applyMiddlewares(app)` - Función que aplica todos los middlewares
- Funciones individuales para cada middleware (útil para testing)

### 4. `services/ocrJobService.js`
Contiene toda la lógica del pipeline OCR:
1. Escribir PDF temporal
2. Extraer páginas a imágenes
3. Filtrar páginas blancas (con quick-OCR)
4. Procesar imágenes válidas con OCR
5. Extraer campos estructurados
6. Enviar callback a Bizagi
7. Limpiar archivos temporales

**Exports:**
- `processOcrJob(pdfBase64, idioma, albaranesEsperados, caseId)` - Función principal asíncrona

**Funciones internas** (bien separadas para testing futuro):
- `extractPagesToImages()`
- `filterBlankPages()`
- `processImagesWithOcr()`
- `extractFields()`
- `buildCallbackPayload()`
- `cleanupTempFiles()`

### 5. `services/bizagiService.js`
Maneja la comunicación con Bizagi.

**Exports:**
- `sendCallback(caseId, data)` - Envía resultado a Bizagi
- `getCallbackState(caseId)` - Consulta estado de callback
- `clearCallbackState(caseId)` - Limpia estado
- `jobCallbackState` - Map en memoria (para debug)

### 6. `routes/processRoutes.js`
Ruta principal de procesamiento.

**Endpoints:**
- `POST /api/process-pdf` - Valida request, encola job, devuelve `{status: 'queued', caseId}`

### 7. `routes/healthRoutes.js`
Rutas de monitoreo.

**Endpoints:**
- `GET /metrics` - Métricas Prometheus
- `GET /health` - Health check básico

### 8. `routes/index.js`
Agregador que monta todas las rutas en el app Express.

