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
  "albaranesEsperados": 8
}
```

**Response:**

```json
{
  "paginasInput": 10,
  "albaranesExtraidos": 7,
  "statusError": true,
  "mensaje": "Solo se reconocieron 7 de 8 albaranes. | 2 albaranes parcialmente extraídos.",
  "datos": [
    {
      "pag": 5,
      "departamento": "96",
      "numeroOrden": "1900942645",
      "numeroRecibo": "211306",
      "total": null,
      "statusError": false,
      "mensaje": ""
    }
  ]
}
```

Cada entrada en `datos` tiene `statusError: true` si le faltó algún campo clave.

### GET `/health`

Verifica que Tesseract, Poppler y el disco funcionen bien.

### GET `/metrics`

Métricas de Prometheus (requests, errores, tiempos, recursos).

## Variables de entorno

```
PORT=3000
OCR_CONCURRENCY=5
HTTP_TIMEOUT_MS=600000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
```

`OCR_CONCURRENCY` controla cuántas páginas se procesan en paralelo. Ajústalo según tu servidor: con 2 vCPU pon 2-3, con 4 vCPU prueba 5-6.

## Limitaciones

- Solo PDFs (no imágenes sueltas)
- Límite de 60 páginas por documento
- El OCR no es perfecto con documentos muy deteriorados
