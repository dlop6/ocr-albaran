# API de Procesamiento OCR Asíncrono con Polling

Esta API proporciona procesamiento de OCR de documentos PDF de forma asíncrona usando un sistema de polling. Permite iniciar trabajos de procesamiento y consultar su estado y resultado sin bloquear el cliente.

## Endpoints Disponibles

### 1. Iniciar Procesamiento OCR

**Endpoint:** `POST /api/start-process`

**Descripción:** Inicia un trabajo de procesamiento OCR asíncrono y devuelve un ID único para rastrear el progreso.

**Request Body:**
```json
{
    "pdfBase64": "JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCg==",
    "idioma": "ESP",
    "albaranesEsperados": 2
}
```

**Parámetros:**
- `pdfBase64` (string, requerido): Archivo PDF codificado en base64
- `idioma` (string, requerido): Idioma del documento ("ESP" o "ING")
- `albaranesEsperados` (number, opcional): Número esperado de albaranes a extraer

**Response:**
```json
{
    "jobId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Códigos de Estado:**
- `200`: Trabajo creado exitosamente
- `400`: Error en parámetros de entrada
- `500`: Error interno del servidor

---

### 2. Consultar Estado del Trabajo

**Endpoint:** `GET /api/job-status/:jobId`

**Descripción:** Consulta el estado actual de un trabajo de procesamiento OCR.

**Parámetros de URL:**
- `jobId` (string, requerido): ID único del trabajo

**Response:**
```json
{
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "procesando"
}
```

**Estados Posibles:**
- `pendiente`: Trabajo en cola, esperando procesamiento
- `procesando`: Trabajo siendo procesado actualmente
- `terminado`: Trabajo completado exitosamente
- `error`: Trabajo falló con error

**Códigos de Estado:**
- `200`: Estado consultado exitosamente
- `404`: Trabajo no encontrado
- `500`: Error interno del servidor

---

### 3. Obtener Resultado del Trabajo

**Endpoint:** `GET /api/job-result/:jobId`

**Descripción:** Obtiene el resultado del procesamiento OCR. Siempre devuelve el mismo formato JSON independientemente del estado del trabajo.

**Parámetros de URL:**
- `jobId` (string, requerido): ID único del trabajo

**Response (Éxito):**
```json
{
    "paginasInput": 3,
    "albaranesExtraidos": 2,
    "datos": [
        {
            "pag": 1,
            "departamento": "95",
            "numeroOrden": "1100947238",
            "numeroRecibo": "196257",
            "total": 1250.50,
            "statusError": false,
            "mensaje": ""
        },
        {
            "pag": 2,
            "departamento": "96",
            "numeroOrden": "1100947239",
            "numeroRecibo": "196258",
            "total": 875.25,
            "statusError": false,
            "mensaje": ""
        }
    ],
    "statusError": false,
    "mensaje": "PDF procesado correctamente: 3 páginas, 15.2s, 2 albaranes extraídos"
}
```

**Response (Error):**
```json
{
    "paginasInput": 0,
    "albaranesExtraidos": 0,
    "datos": [],
    "statusError": true,
    "mensaje": "Error al procesar el PDF: archivo corrupto"
}
```

**Response (En Proceso):**
```json
{
    "paginasInput": 0,
    "albaranesExtraidos": 0,
    "datos": [],
    "statusError": false,
    "mensaje": "Trabajo en procesamiento, intente más tarde"
}
```

**Campos del Resultado:**
- `paginasInput` (number): Número total de páginas del PDF procesado
- `albaranesExtraidos` (number): Número de albaranes extraídos exitosamente
- `datos` (array): Array de objetos con datos extraídos de cada albarán
- `statusError` (boolean): Indica si ocurrió un error en el procesamiento
- `mensaje` (string): Mensaje descriptivo del resultado o error

**Campos de Cada Dato Extraído:**
- `pag` (number): Número de página donde se encontró el albarán
- `departamento` (string): Código del departamento
- `numeroOrden` (string): Número de orden
- `numeroRecibo` (string): Número de recibo
- `total` (number): Monto total del albarán
- `statusError` (boolean): Indica si hubo error extrayendo este albarán específico
- `mensaje` (string): Mensaje de error específico si aplica

**Códigos de Estado:**
- `200`: Resultado obtenido (independientemente del estado del trabajo)
- `404`: Trabajo no encontrado (pero mantiene formato JSON)
- `500`: Error interno del servidor (pero mantiene formato JSON)

---

### 4. Estadísticas del Sistema (Opcional)

**Endpoint:** `GET /api/job-stats`

**Descripción:** Obtiene estadísticas del sistema de trabajos para monitoreo.

**Response:**
```json
{
    "jobs": {
        "total": 25,
        "pendiente": 3,
        "procesando": 1,
        "terminado": 19,
        "error": 2
    },
    "worker": {
        "isRunning": true,
        "isProcessing": true,
        "processInterval": 5000
    }
}
```

---

## Flujo de Uso Típico

### 1. Flujo Básico de Polling

```javascript
// 1. Iniciar procesamiento
const response = await fetch('/api/start-process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        pdfBase64: pdfBase64String,
        idioma: 'ESP',
        albaranesEsperados: 2
    })
});
const { jobId } = await response.json();

// 2. Polling del estado
let status = 'pendiente';
while (status === 'pendiente' || status === 'procesando') {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Esperar 2 segundos
    
    const statusResponse = await fetch(`/api/job-status/${jobId}`);
    const statusData = await statusResponse.json();
    status = statusData.status;
    
    console.log(`Estado actual: ${status}`);
}

// 3. Obtener resultado final
const resultResponse = await fetch(`/api/job-result/${jobId}`);
const result = await resultResponse.json();

if (result.statusError) {
    console.error('Error en procesamiento:', result.mensaje);
} else {
    console.log(`Éxito: ${result.albaranesExtraidos} albaranes extraídos`);
    console.log('Datos:', result.datos);
}
```

### 2. Ejemplo con Manejo de Errores

```javascript
async function procesarPDF(pdfBase64, idioma) {
    try {
        // Iniciar trabajo
        const startResponse = await fetch('/api/start-process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pdfBase64, idioma })
        });
        
        if (!startResponse.ok) {
            throw new Error('Error iniciando procesamiento');
        }
        
        const { jobId } = await startResponse.json();
        
        // Polling con timeout
        const maxWaitTime = 300000; // 5 minutos
        const pollInterval = 3000; // 3 segundos
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWaitTime) {
            // Consultar estado
            const statusResponse = await fetch(`/api/job-status/${jobId}`);
            const statusData = await statusResponse.json();
            
            if (statusData.status === 'terminado' || statusData.status === 'error') {
                break;
            }
            
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
        
        // Obtener resultado
        const resultResponse = await fetch(`/api/job-result/${jobId}`);
        const result = await resultResponse.json();
        
        return result;
        
    } catch (error) {
        console.error('Error en procesamiento:', error);
        throw error;
    }
}
```

## Notas Importantes

1. **Formato Consistente**: Todos los endpoints que devuelven resultados mantienen el mismo formato JSON, incluso en caso de error.

2. **Timeout**: Se recomienda implementar un timeout en el cliente para evitar polling infinito.

3. **Intervalo de Polling**: Se recomienda un intervalo de 2-5 segundos entre consultas de estado.

4. **Limpieza Automática**: Los trabajos antiguos (>24 horas) se eliminan automáticamente del sistema.

5. **Concurrencia**: El sistema procesa un trabajo a la vez para evitar sobrecarga del servidor.

6. **Logs**: Todos los procesos son registrados en logs para debugging y monitoreo.

## Endpoints Heredados

La API mantiene el endpoint original para compatibilidad:

- `POST /api/process-pdf`: Procesamiento síncrono (bloquea hasta completar)
- `GET /health`: Estado de salud del servidor
- `GET /metrics`: Métricas de Prometheus

## Códigos de Error Comunes

- `400`: Parámetros inválidos o formato base64 incorrecto
- `404`: Trabajo no encontrado (jobId inválido)  
- `500`: Error interno del servidor
- `503`: Timeout del servidor (procesamiento muy largo)