const fs = require('fs');
const path = require('path');

/**
 * Test end-to-end del sistema de procesamiento OCR asíncrono con polling
 * 
 * Este archivo prueba todo el flujo completo:
 * 1. Inicia un trabajo de procesamiento OCR
 * 2. Hace polling del estado hasta que termine
 * 3. Obtiene el resultado final
 * 4. Valida el formato de respuesta
 */

// Configuración del test
const API_BASE_URL = process.env.API_URL || 'https://ocr-albaranes-polling-latest.onrender.com';
const TEST_PDF_PATH = './docs/albaran ingles.pdf'; // Ajustar según archivo disponible
const POLL_INTERVAL = 2000; // 2 segundos entre polls
const MAX_WAIT_TIME = 300000; // 5 minutos máximo de espera

class OCRPollingTest {
    constructor() {
        this.testResults = {
            startProcess: { passed: false, error: null, data: null },
            polling: { passed: false, error: null, statusChanges: [] },
            getResult: { passed: false, error: null, data: null },
            validation: { passed: false, errors: [] }
        };
    }

    /**
     * Ejecuta todos los tests end-to-end
     */
    async runAllTests() {
        console.log('🚀 Iniciando tests end-to-end del sistema de polling OCR\n');
        console.log(`📡 API Base URL: ${API_BASE_URL}`);
        console.log(`📄 PDF de prueba: ${TEST_PDF_PATH}\n`);

        try {
            // Verificar que el servidor esté corriendo
            await this.checkServerHealth();

            // Cargar PDF de prueba
            const pdfBase64 = await this.loadTestPDF();

            // Test 1: Iniciar procesamiento
            console.log('📋 Test 1: Iniciar procesamiento OCR...');
            const jobId = await this.testStartProcess(pdfBase64);

            // Test 2: Polling del estado
            console.log('⏳ Test 2: Polling del estado del trabajo...');
            await this.testPolling(jobId);

            // Test 3: Obtener resultado
            console.log('📊 Test 3: Obtener resultado final...');
            await this.testGetResult(jobId);

            // Test 4: Validar formato
            console.log('✅ Test 4: Validar formato de respuesta...');
            this.validateResponseFormat();

            // Imprimir resumen
            this.printTestSummary();

        } catch (error) {
            console.error('❌ Error crítico en tests:', error.message);
            process.exit(1);
        }
    }

    /**
     * Verifica que el servidor esté funcionando
     */
    async checkServerHealth() {
        try {
            const response = await fetch(`${API_BASE_URL}/health`);
            if (!response.ok) {
                throw new Error(`Servidor no responde: ${response.status}`);
            }
            console.log('✅ Servidor está funcionando\n');
        } catch (error) {
            throw new Error(`No se puede conectar al servidor: ${error.message}`);
        }
    }

    /**
     * Carga el PDF de prueba y lo convierte a base64
     */
    async loadTestPDF() {
        try {
            if (!fs.existsSync(TEST_PDF_PATH)) {
                throw new Error(`Archivo PDF no encontrado: ${TEST_PDF_PATH}`);
            }

            const pdfBuffer = fs.readFileSync(TEST_PDF_PATH);
            const pdfBase64 = pdfBuffer.toString('base64');
            
            console.log(`📄 PDF cargado: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB\n`);
            return pdfBase64;

        } catch (error) {
            throw new Error(`Error cargando PDF: ${error.message}`);
        }
    }

    /**
     * Test 1: Iniciar procesamiento OCR
     */
    async testStartProcess(pdfBase64) {
        try {
            const payload = {
                pdfBase64: pdfBase64,
                idioma: 'ING',
                albaranesEsperados: 1
            };

            console.log(`   📤 Enviando payload (PDF: ${Math.round(pdfBase64.length / 1024)}KB)...`);

            const response = await fetch(`${API_BASE_URL}/api/start-process`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`HTTP ${response.status}: ${errorData.error || 'Error desconocido'}`);
            }

            const data = await response.json();
            
            // Validar respuesta
            if (!data.jobId || typeof data.jobId !== 'string') {
                throw new Error('Respuesta inválida: falta jobId');
            }

            this.testResults.startProcess = {
                passed: true,
                error: null,
                data: data
            };

            console.log(`   ✅ Trabajo iniciado exitosamente`);
            console.log(`   🆔 Job ID: ${data.jobId}\n`);

            return data.jobId;

        } catch (error) {
            this.testResults.startProcess = {
                passed: false,
                error: error.message,
                data: null
            };
            throw error;
        }
    }

    /**
     * Test 2: Polling del estado
     */
    async testPolling(jobId) {
        try {
            const startTime = Date.now();
            let currentStatus = 'pendiente';
            const statusChanges = [];

            while (Date.now() - startTime < MAX_WAIT_TIME) {
                // Consultar estado
                const response = await fetch(`${API_BASE_URL}/api/job-status/${jobId}`);
                
                if (!response.ok) {
                    throw new Error(`Error consultando estado: ${response.status}`);
                }

                const statusData = await response.json();
                
                // Validar estructura de respuesta
                if (!statusData.hasOwnProperty('status') || !statusData.hasOwnProperty('jobId')) {
                    throw new Error('Estructura de respuesta inválida en job-status');
                }

                // Registrar cambio de estado
                if (statusData.status !== currentStatus) {
                    const timestamp = new Date().toISOString();
                    statusChanges.push({
                        timestamp,
                        oldStatus: currentStatus,
                        newStatus: statusData.status,
                        elapsedMs: Date.now() - startTime
                    });
                    
                    console.log(`   📊 Estado: ${currentStatus} → ${statusData.status} (${Math.round((Date.now() - startTime) / 1000)}s)`);
                    currentStatus = statusData.status;
                }

                // Verificar si terminó
                if (['terminado', 'error'].includes(statusData.status)) {
                    break;
                }

                // Esperar antes del siguiente poll
                await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
            }

            // Verificar timeout
            if (!['terminado', 'error'].includes(currentStatus)) {
                throw new Error(`Timeout: trabajo no completó en ${MAX_WAIT_TIME / 1000}s`);
            }

            this.testResults.polling = {
                passed: true,
                error: null,
                statusChanges: statusChanges
            };

            const totalTime = Math.round((Date.now() - startTime) / 1000);
            console.log(`   ✅ Polling completado en ${totalTime}s`);
            console.log(`   🔄 Cambios de estado: ${statusChanges.length}\n`);

        } catch (error) {
            this.testResults.polling = {
                passed: false,
                error: error.message,
                statusChanges: []
            };
            throw error;
        }
    }

    /**
     * Test 3: Obtener resultado final
     */
    async testGetResult(jobId) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/job-result/${jobId}`);
            
            // Nota: Este endpoint siempre debe devolver 200 con formato fijo
            if (!response.ok && response.status !== 404) {
                throw new Error(`Error obteniendo resultado: ${response.status}`);
            }

            const result = await response.json();

            this.testResults.getResult = {
                passed: true,
                error: null,
                data: result
            };

            console.log(`   ✅ Resultado obtenido exitosamente`);
            console.log(`   📄 Páginas procesadas: ${result.paginasInput || 0}`);
            console.log(`   📋 Albaranes extraídos: ${result.albaranesExtraidos || 0}`);
            console.log(`   ❗ Error en procesamiento: ${result.statusError ? 'SÍ' : 'NO'}`);
            if (result.mensaje) {
                console.log(`   💬 Mensaje: ${result.mensaje}`);
            }
            console.log();

        } catch (error) {
            this.testResults.getResult = {
                passed: false,
                error: error.message,
                data: null
            };
            throw error;
        }
    }

    /**
     * Test 4: Validar formato de respuesta
     */
    validateResponseFormat() {
        const errors = [];
        const result = this.testResults.getResult.data;

        if (!result) {
            errors.push('No hay resultado para validar');
            this.testResults.validation = { passed: false, errors };
            return;
        }

        // Validar campos requeridos
        const requiredFields = ['paginasInput', 'albaranesExtraidos', 'datos', 'statusError', 'mensaje'];
        
        for (const field of requiredFields) {
            if (!result.hasOwnProperty(field)) {
                errors.push(`Campo requerido faltante: ${field}`);
            }
        }

        // Validar tipos
        if (typeof result.paginasInput !== 'number') {
            errors.push('paginasInput debe ser number');
        }
        if (typeof result.albaranesExtraidos !== 'number') {
            errors.push('albaranesExtraidos debe ser number');
        }
        if (!Array.isArray(result.datos)) {
            errors.push('datos debe ser array');
        }
        if (typeof result.statusError !== 'boolean') {
            errors.push('statusError debe ser boolean');
        }
        if (typeof result.mensaje !== 'string') {
            errors.push('mensaje debe ser string');
        }

        // Validar datos extraídos
        if (Array.isArray(result.datos)) {
            result.datos.forEach((item, index) => {
                const requiredItemFields = ['pag', 'departamento', 'numeroOrden', 'numeroRecibo', 'total', 'statusError', 'mensaje'];
                
                for (const field of requiredItemFields) {
                    if (!item.hasOwnProperty(field)) {
                        errors.push(`Campo faltante en datos[${index}]: ${field}`);
                    }
                }
            });
        }

        this.testResults.validation = {
            passed: errors.length === 0,
            errors: errors
        };

        if (errors.length === 0) {
            console.log('   ✅ Formato de respuesta válido\n');
        } else {
            console.log('   ❌ Errores de formato:');
            errors.forEach(error => console.log(`      - ${error}`));
            console.log();
        }
    }

    /**
     * Imprime resumen de todos los tests
     */
    printTestSummary() {
        console.log('📋 RESUMEN DE TESTS');
        console.log('==================\n');

        const tests = [
            { name: 'Iniciar Procesamiento', result: this.testResults.startProcess },
            { name: 'Polling de Estado', result: this.testResults.polling },
            { name: 'Obtener Resultado', result: this.testResults.getResult },
            { name: 'Validar Formato', result: this.testResults.validation }
        ];

        let passedCount = 0;
        let totalCount = tests.length;

        tests.forEach(test => {
            const status = test.result.passed ? '✅ PASS' : '❌ FAIL';
            console.log(`${status} - ${test.name}`);
            
            if (!test.result.passed && test.result.error) {
                console.log(`         Error: ${test.result.error}`);
            }
            
            if (!test.result.passed && test.result.errors && test.result.errors.length > 0) {
                test.result.errors.forEach(error => {
                    console.log(`         - ${error}`);
                });
            }

            if (test.result.passed) passedCount++;
        });

        console.log(`\n📊 Resultado Final: ${passedCount}/${totalCount} tests pasaron`);

        if (passedCount === totalCount) {
            console.log('🎉 ¡Todos los tests pasaron exitosamente!');
            console.log('✅ El sistema de polling OCR está funcionando correctamente');
        } else {
            console.log('⚠️  Algunos tests fallaron. Revisar errores arriba.');
            process.exit(1);
        }

        // Imprimir datos adicionales si están disponibles
        if (this.testResults.polling.statusChanges.length > 0) {
            console.log('\n🔄 CRONOLOGÍA DE ESTADOS:');
            this.testResults.polling.statusChanges.forEach(change => {
                console.log(`   ${change.timestamp}: ${change.oldStatus} → ${change.newStatus} (+${Math.round(change.elapsedMs / 1000)}s)`);
            });
        }

        if (this.testResults.getResult.data) {
            console.log('\n📊 RESULTADO FINAL:');
            console.log(`   Páginas Input: ${this.testResults.getResult.data.paginasInput}`);
            console.log(`   Albaranes Extraídos: ${this.testResults.getResult.data.albaranesExtraidos}`);
            console.log(`   Status Error: ${this.testResults.getResult.data.statusError}`);
            console.log(`   Mensaje: ${this.testResults.getResult.data.mensaje || 'N/A'}`);
        }
    }

    /**
     * Test específico para casos de error
     */
    async testErrorCases() {
        console.log('\n🧪 TESTS DE CASOS DE ERROR\n');

        // Test: jobId inexistente
        try {
            console.log('🔍 Test: jobId inexistente...');
            const fakeJobId = 'job-inexistente-12345';
            
            const statusResponse = await fetch(`${API_BASE_URL}/api/job-status/${fakeJobId}`);
            const resultResponse = await fetch(`${API_BASE_URL}/api/job-result/${fakeJobId}`);
            
            console.log(`   Status response: ${statusResponse.status}`);
            console.log(`   Result response: ${resultResponse.status}`);
            
            if (resultResponse.status === 404) {
                const result = await resultResponse.json();
                console.log(`   ✅ Formato mantenido en error 404`);
                console.log(`   📋 statusError: ${result.statusError}`);
            }
            
        } catch (error) {
            console.log(`   ❌ Error en test de jobId inexistente: ${error.message}`);
        }

        // Test: PDF inválido
        try {
            console.log('\n🔍 Test: PDF inválido...');
            const invalidPayload = {
                pdfBase64: 'invalid-base64-data',
                idioma: 'ESP'
            };

            const response = await fetch(`${API_BASE_URL}/api/start-process`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(invalidPayload)
            });

            console.log(`   Response status: ${response.status}`);
            
            if (!response.ok) {
                const errorData = await response.json();
                console.log(`   ✅ Error manejado correctamente: ${errorData.error}`);
            }
            
        } catch (error) {
            console.log(`   ❌ Error en test de PDF inválido: ${error.message}`);
        }

        console.log('\n✅ Tests de casos de error completados\n');
    }
}

/**
 * Función principal
 */
async function main() {
    const test = new OCRPollingTest();
    
    try {
        // Tests principales
        await test.runAllTests();
        
        // Tests de casos de error (opcional)
        await test.testErrorCases();
        
    } catch (error) {
        // Solo mostrar el mensaje de error, nunca el objeto completo
        console.error('💥 Test fallido:', error && error.message ? error.message : 'Error desconocido');
        process.exit(1);
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    main().catch(console.error);
}

module.exports = OCRPollingTest;