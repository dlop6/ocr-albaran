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

### POST `/api/process-pdf`

Procesa un PDF enviado en base64, filtra solo las páginas relevantes (por keywords como "Proof of Receipt", "DETALLES RECIBO", etc.), y extrae campos estructurados de cada página relevante.

**Body JSON:**
```json
{
  "pdfBase64": "...base64..."
}
```

**Respuesta exitosa (nueva estructura):**
```json
{
  "pages": [
    {
      "pag": 1,
      "departamento": "Compras",
      "numeroOrden": "PO-12345",
      "numeroRecibo": "RV-98765",
      "total": 1234.56,
      "statusError": false,
      "mensaje": ""
    },
    {
      "pag": 2,
      "departamento": "",
      "numeroOrden": "PO-54321",
      "numeroRecibo": "",
      "total": 0,
      "statusError": true,
      "mensaje": "No se encontró Departamento|No se encontró Receiver|No se encontró Total"
    }
    // ...una entrada por cada página relevante
  ],
  "pdfProcessSeconds": 5.23
}
```

**Campos de la respuesta:**
- `pag`: número de página (1-based)
- `departamento`: valor extraído o vacío
- `numeroOrden`: valor extraído o vacío
- `numeroRecibo`: valor extraído o vacío
- `total`: número extraído o 0
- `statusError`: true si faltó algún campo clave
- `mensaje`: concatenación de advertencias por campo no encontrado

**Errores comunes:**
- `400`: pdfBase64 faltante, inválido o no es PDF
- `400`: PDF excede el límite de páginas
- `500`: Error interno de procesamiento

**Notas:**
- Solo se devuelven páginas relevantes (con keywords configurables en el código).
- Si ningún campo es encontrado en una página, `statusError` será true y `mensaje` detallará los faltantes.
- El campo `total` siempre es numérico (0 si no se encontró).

**Ejemplo de uso:**
Ver sección de ejemplos en `/test/` o consulta los archivos JSON de resultados en `/temp_results/`.




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
- Archivos `eng.traineddata` y `spa.traineddata` en la carpeta `/data/`

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
