## 🚦 Recomendaciones de despliegue y ajuste de concurrencia

- **OCR_CONCURRENCY**: Controla cuántas páginas se procesan en paralelo. Un valor alto acelera PDFs grandes pero aumenta el uso de CPU y RAM. Para servidores con 2 vCPU y 2GB RAM, se recomienda `OCR_CONCURRENCY=2` o `3`. Para 4 vCPU y 4GB RAM, puedes probar `5` o `6`. Ajusta según tus métricas y monitoreo.
- **Node.js**: Usa Node.js >= 18 para mejor gestión de memoria y rendimiento.
- **RAM**: Mínimo 2GB, ideal 4GB+ para procesamiento concurrente.
- **Producción**: Considera usar PM2 o el modo cluster de Node.js para aprovechar varios núcleos.
- **Monitoreo**: Usa las métricas Prometheus expuestas para ajustar concurrencia y detectar cuellos de botella.
- **Limpieza**: El sistema elimina archivos temporales automáticamente, pero revisa espacio en disco si procesas muchos PDFs grandes.
# OCR Albarán

OCR Albarán es un servicio Node.js para procesar archivos PDF de albaranes y extraer su texto mediante OCR avanzado, soportando documentos en español e inglés, rotados o de baja calidad.

## 🚀 Endpoints API

### Modo Síncrono (Original)

### POST `/api/process-pdf`

Procesa un PDF enviado en base64, filtra solo las páginas relevantes (por keywords como "Proof of Receipt", "DETALLES RECIBO", etc.), y extrae campos estructurados de cada página relevante.

**Body JSON:**

```json
{
  "pdfBase64": "...base64...",
  "idioma": "ESP", // o "ING"
  "albaranesEsperados": 8 // (opcional)
}
```

**Respuesta exitosa:**

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
    // ...una entrada por cada albarán extraído
  ]
}
```

### Modo Asíncrono (Polling) - **RECOMENDADO**

Para PDFs grandes o procesos que pueden tardar más de 30 segundos, usa el modo asíncrono que evita problemas de timeout.

### POST `/api/start-process`

Inicia el procesamiento de un PDF y devuelve un `requestId` para hacer seguimiento.

**Body JSON:**

```json
{
  "pdfBase64": "...base64...",
  "idioma": "ESP", // o "ING"
  "albaranesEsperados": 8 // (opcional)
}
```

**Respuesta:**

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "estimatedTimeMinutes": 3
}
```

### GET `/api/status/{requestId}`

Consulta el estado del procesamiento.

**Respuesta:**

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing", // pending|processing|completed|error
  "createdAt": "2025-10-02T10:30:00Z",
  "updatedAt": "2025-10-02T10:31:30Z",
  "progress": "Procesando OCR: 75% (15/20)",
  "estimatedRemainingMinutes": 1
}
```

### GET `/api/result/{requestId}`

Obtiene el resultado final cuando el estado es `completed`.

**Respuesta (mismo formato que el endpoint síncrono):**

```json
{
  "paginasInput": 3,
  "albaranesExtraidos": 1,
  "datos": [
    {
      "pag": 2,
      "departamento": "95",
      "numeroOrden": "1100947238",
      "numeroRecibo": "196257",
      "total": 0,
      "statusError": false,
      "mensaje": ""
    }
  ],
  "statusError": false,
  "mensaje": ""
}
```

**Errores:**
- `404`: RequestId no encontrado
- `425`: Procesamiento aún no completado
- `500`: Error en el procesamiento

### Flujo de Polling Recomendado

1. **Iniciar:** `POST /api/start-process` → obtener `requestId`
2. **Esperar:** 30-60 segundos (tiempo inicial)
3. **Consultar:** `GET /api/status/{requestId}` cada 30-60 segundos
4. **Repetir paso 3** hasta que `status` sea `completed` o `error`
5. **Obtener resultado:** `GET /api/result/{requestId}`

### GET `/api/jobs` (Debug)

Lista todos los trabajos activos (solo para desarrollo/testing).

**Respuesta:**

```json
{
  "stats": {
    "total": 5,
    "pending": 1,
    "processing": 2,
    "completed": 2,
    "error": 0
  },
  "jobs": [
    {
      "requestId": "...",
      "status": "processing",
      "createdAt": "...",
      "progress": "Procesando OCR: 50%"
    }
  ]
}
```




## ⚙️ Variables de entorno

- `OCR_CONCURRENCY` (opcional): Máximo de páginas procesadas en paralelo (default: 5)
- `PORT` (opcional): Puerto del servidor Express (default: 3000)
- `HTTP_TIMEOUT_MS` (opcional): Timeout global de cada petición HTTP en milisegundos (default: 600000 = 10 minutos). Si una petición tarda más, se aborta automáticamente con error 503.
- `CORS_ORIGINS` (opcional): Lista de orígenes permitidos para CORS, separados por coma (default: solo localhost). Ejemplo: `CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000`
- `RATE_LIMIT_WINDOW_MS` (opcional): Ventana de tiempo para rate limiting en ms (default: 900000 = 15 min)
- `RATE_LIMIT_MAX` (opcional): Máximo de requests por IP por ventana (default: 100)

## 🛠️ Instalación y uso

1. Clona el repositorio y entra al directorio.
2. Instala dependencias:
   ```bash
   npm install
   ```
3. Crea un archivo `.env` (opcional) basado en `.env.example`.
4. Inicia el servidor:
   ```bash
   npm start
   ```

## 📦 Requisitos
- Node.js >= 16
- poppler-utils instalado en el sistema

## ❗ Limitaciones y supuestos
- Solo PDFs, no imágenes sueltas.
- El PDF debe estar en base64.
- El límite de páginas es 60 (configurable).
- No se garantiza 100% de precisión en OCR para documentos muy deteriorados.



## 🩺 Endpoints de salud y métricas

- `/health`: Verifica dependencias críticas (Tesseract, Poppler, espacio en disco).
- `/metrics`: Expone métricas Prometheus (requests, errores, tiempos, recursos).

### Métricas de performance expuestas

- `pdf_process_duration_seconds`: Histograma de duración total del procesamiento de PDF (segundos)
- `page_process_duration_seconds`: Histograma de duración del procesamiento de cada página (segundos)

Estas métricas permiten monitorear y alertar sobre cuellos de botella o degradación de performance.

---

Desarrollado por TrustSystems. Para dudas o soporte, contacta a soporte@trustsystems.com
