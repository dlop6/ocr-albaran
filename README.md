# OCR Albarán

Servicio para procesar PDFs de albaranes y extraer datos por OCR. Soporta español e inglés, incluso si los documentos están rotados o tienen mala calidad.

## Requisitos

- Node.js >= 16
- poppler-utils
- Tesseract OCR (con idiomas spa y eng)

## Instalación

```bash
npm install
npm start
```

## API

### POST `/api/process-pdf`

Envías un PDF en base64, el servicio filtra páginas relevantes (las que tienen keywords tipo "Proof of Receipt", "DETALLES RECIBO", etc.) y extrae los campos.

**Request:**

```json
{
  "pdfBase64": "...base64...",
  "idioma": "ESP",
  "albaranesEsperados": 8,
  "caseId": 12345
}
```

**Immediate response (queued):**

After the request is accepted the service enqueues the OCR job and returns immediately with a minimal response. The OCR runs asynchronously in background and the service will callback Bizagi (see below) when finished.

```json
{
  "status": "queued",
  "caseId": 12345
}
```

The final OCR result is delivered to Bizagi with a POST to the configured callback URL (see "Bizagi callback" below). The older synchronous response (full extraction in the request) is no longer returned by /api/process-pdf.

Cada entrada en `datos` tiene `statusError: true` si le faltó algún campo clave.

### GET `/health`

Verifica que Tesseract, Poppler y el disco funcionen bien.

### GET `/metrics`

Métricas de Prometheus (requests, errores, tiempos, recursos).

## Variables de entorno

```bash
PORT=3000
OCR_CONCURRENCY=5
HTTP_TIMEOUT_MS=600000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
```

Additionally, to enable Bizagi callbacks you must set:

```bash
BIZAGI_BASE_URL=https://your-bizagi.example.com
BIZAGI_TOKEN=<<your-bearer-token>>
```

If `BIZAGI_BASE_URL` or `BIZAGI_TOKEN` are not set the service will still process PDFs but will skip the callback and log a warning.

`OCR_CONCURRENCY` controla cuántas páginas se procesan en paralelo. Ajústalo según tu servidor: con 2 vCPU pon 2-3, con 4 vCPU prueba 5-6.

## Limitaciones

- Solo PDFs (no imágenes sueltas)
- Límite de 60 páginas por documento
- El OCR no es perfecto con documentos muy deteriorados
