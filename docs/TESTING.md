# Testing del Sistema de Polling OCR

Este directorio contiene herramientas para probar el sistema de procesamiento OCR asíncrono con polling.

## Archivos de Test

### 1. `test-polling-e2e.js` - Test End-to-End Completo

Test exhaustivo que valida todo el flujo de polling OCR:

```bash
# Ejecutar test completo
node test-polling-e2e.js

# O usando npm
npm run test:polling
```

**Qué prueba:**
- ✅ Conectividad del servidor
- ✅ Inicio de trabajo OCR (`/api/start-process`)
- ✅ Polling de estado (`/api/job-status/:jobId`)
- ✅ Obtención de resultado (`/api/job-result/:jobId`)
- ✅ Validación de formato de respuesta
- ✅ Manejo de errores (jobId inexistente, PDF inválido)
- ✅ Cronología de cambios de estado

**Configuración:**
```javascript
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_PDF_PATH = './docs/albaran ingles.pdf';
const POLL_INTERVAL = 2000; // 2 segundos
const MAX_WAIT_TIME = 300000; // 5 minutos
```

### 2. `quick-test.js` - Test Rápido

Test simple y rápido para validación básica:

```bash
# Test con archivo por defecto
node quick-test.js

# Test con PDF específico
node quick-test.js ./docs/albaran\ ingles.pdf

# Test con archivo base64
node quick-test.js ./temp_pdf_base64.txt

# O usando npm
npm run test:quick
npm run test:quick-txt
```

**Qué hace:**
- Carga un PDF (archivo directo o base64)
- Inicia trabajo OCR
- Hace polling hasta completar
- Muestra resultado final

## Scripts NPM Disponibles

```bash
# Iniciar servidor
npm start

# Test completo end-to-end
npm run test:polling

# Test rápido con temp_pdf_base64.txt
npm run test:quick

# Test rápido con archivo base64 específico
npm run test:quick-txt

# Verificar salud del servidor
npm run test:health

# Ver estadísticas de trabajos
npm run test:stats
```

## Configuración de Environment

```bash
# URL de la API (opcional, default: http://localhost:3000)
export API_URL=https://ocr-albaranes.mangotree-243a6af9.westus2.azurecontainerapps.io

# Ejecutar tests contra Azure
npm run test:quick
```

## Archivos PDF de Prueba

Los tests buscan PDFs en estas ubicaciones (en orden):

1. `./docs/albaran ingles.pdf`
2. `./docs/albaran español baja calidad.pdf`
3. `./docs/EJEMPLO 1.pdf`
4. `./temp_pdf_base64.txt` (archivo base64)

## Ejemplos de Salida

### Test Exitoso
```
🚀 Iniciando tests end-to-end del sistema de polling OCR

📡 API Base URL: http://localhost:3000
📄 PDF de prueba: ./docs/albaran ingles.pdf

✅ Servidor está funcionando

📄 PDF cargado: 0.45 MB

📋 Test 1: Iniciar procesamiento OCR...
   ✅ Trabajo iniciado exitosamente
   🆔 Job ID: 550e8400-e29b-41d4-a716-446655440000

⏳ Test 2: Polling del estado del trabajo...
   📊 Estado: pendiente → procesando (2s)
   📊 Estado: procesando → terminado (18s)
   ✅ Polling completado en 18s
   🔄 Cambios de estado: 2

📊 Test 3: Obtener resultado final...
   ✅ Resultado obtenido exitosamente
   📄 Páginas procesadas: 3
   📋 Albaranes extraídos: 1
   ❗ Error en procesamiento: NO
   💬 Mensaje: PDF procesado correctamente: 3 páginas, 15.2s, 1 albaranes extraídos

✅ Test 4: Validar formato de respuesta...
   ✅ Formato de respuesta válido

📋 RESUMEN DE TESTS
==================

✅ PASS - Iniciar Procesamiento
✅ PASS - Polling de Estado
✅ PASS - Obtener Resultado
✅ PASS - Validar Formato

📊 Resultado Final: 4/4 tests pasaron
🎉 ¡Todos los tests pasaron exitosamente!
✅ El sistema de polling OCR está funcionando correctamente
```

### Test con Error
```
❌ FAIL - Obtener Resultado
         Error: HTTP 500: Error interno del servidor

📊 Resultado Final: 3/4 tests pasaron
⚠️  Algunos tests fallaron. Revisar errores arriba.
```

## Debugging

### Ver logs del servidor
```bash
# En otra terminal, ver logs en tiempo real
docker logs -f ocr-albaranes
```

### Verificar endpoints manualmente
```bash
# Health check
curl http://localhost:3000/health

# Estadísticas
curl http://localhost:3000/api/job-stats

# Iniciar trabajo (manual)
curl -X POST http://localhost:3000/api/start-process \
  -H "Content-Type: application/json" \
  -d '{"pdfBase64":"...","idioma":"ING"}'

# Consultar estado
curl http://localhost:3000/api/job-status/JOBID

# Obtener resultado
curl http://localhost:3000/api/job-result/JOBID
```

## Troubleshooting

### Error: "No se puede conectar al servidor"
- Verificar que el servidor esté corriendo en el puerto correcto
- Usar `npm start` para iniciar el servidor
- Verificar la URL con `npm run test:health`

### Error: "Archivo PDF no encontrado"
- Verificar que existe `./docs/albaran ingles.pdf`
- O especificar ruta del PDF: `node quick-test.js ruta/al/archivo.pdf`
- O usar archivo base64: `node quick-test.js temp_pdf_base64.txt`

### Error: "Timeout después de 5 minutos"
- El procesamiento está tardando demasiado
- Verificar logs del servidor para errores
- Probar con un PDF más pequeño

### Error: "Formato de respuesta inválido"
- Verificar que el servidor esté usando la versión correcta del código
- Revisar logs para errores en la API
- Verificar que todos los módulos estén actualizados

## Automatización

### CI/CD Pipeline
```yaml
# Ejemplo para GitHub Actions
- name: Test Polling OCR
  run: |
    npm install
    npm start &
    sleep 10
    npm run test:polling
```

### Monitoring
```bash
# Script para monitoring continuo
while true; do
  npm run test:quick && echo "✅ $(date): Test OK" || echo "❌ $(date): Test FAIL"
  sleep 300  # Cada 5 minutos
done
```