const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3001';
// const BASE_URL = 'https://ocr-albaranes.mangotree-243a6af9.westus2.azurecontainerapps.io';

/**
 * Script de testing para endpoints de polling
 */
async function testPollingWorkflow() {
    console.log('🧪 Iniciando test de polling workflow...\n');

    try {
        // 1. Preparar PDF base64
        console.log('📄 Preparando PDF de prueba...');
        const pdfPath = path.join(__dirname, 'docs', 'EJEMPLO 2.pdf');
        if (!fs.existsSync(pdfPath)) {
            console.error('❌ PDF de prueba no encontrado:', pdfPath);
            return;
        }
        
        const pdfBuffer = fs.readFileSync(pdfPath);
        const pdfBase64 = pdfBuffer.toString('base64');
        const pdfSizeMB = (pdfBuffer.length / (1024 * 1024)).toFixed(2);
        console.log(`✅ PDF cargado: ${pdfSizeMB} MB\n`);

        // 2. Iniciar procesamiento
        console.log('🚀 Iniciando procesamiento asíncrono...');
        const startResponse = await axios.post(`${BASE_URL}/api/start-process`, {
            pdfBase64,
            idioma: 'ESP',
            albaranesEsperados: 3
        });

        const { requestId, status, estimatedTimeMinutes } = startResponse.data;
        console.log(`✅ Procesamiento iniciado:`);
        console.log(`   RequestId: ${requestId}`);
        console.log(`   Status: ${status}`);
        console.log(`   Tiempo estimado: ${estimatedTimeMinutes} minutos\n`);

        // 3. Polling del estado
        console.log('⏳ Iniciando polling del estado...');
        let currentStatus = status;
        let pollCount = 0;
        const maxPolls = 60; // máximo 10 minutos (polling cada 10s)

        while (currentStatus !== 'completed' && currentStatus !== 'error' && pollCount < maxPolls) {
            await sleep(10000); // esperar 10 segundos
            pollCount++;

            console.log(`📊 Poll #${pollCount}: Consultando estado...`);
            
            try {
                const statusResponse = await axios.get(`${BASE_URL}/api/status/${requestId}`);
                const statusData = statusResponse.data;
                
                currentStatus = statusData.status;
                console.log(`   Status: ${currentStatus}`);
                
                if (statusData.progress) {
                    console.log(`   Progreso: ${statusData.progress}`);
                }
                
                if (statusData.estimatedRemainingMinutes !== undefined) {
                    console.log(`   Tiempo restante: ${statusData.estimatedRemainingMinutes} min`);
                }
                
                console.log('');
                
            } catch (statusErr) {
                console.error(`❌ Error consultando estado:`, statusErr.response?.data || statusErr.message);
                break;
            }
        }

        // 4. Obtener resultado
        if (currentStatus === 'completed') {
            console.log('🎉 Procesamiento completado! Obteniendo resultado...');
            
            try {
                const resultResponse = await axios.get(`${BASE_URL}/api/result/${requestId}`);
                const result = resultResponse.data;
                
                console.log('✅ Resultado obtenido:');
                console.log(`   Páginas procesadas: ${result.paginasInput}`);
                console.log(`   Albaranes extraídos: ${result.albaranesExtraidos}`);
                console.log(`   Status error: ${result.statusError}`);
                console.log(`   Mensaje: ${result.mensaje || 'N/A'}`);
                
                if (result.datos && result.datos.length > 0) {
                    console.log('\n📋 Datos extraídos:');
                    result.datos.forEach((item, index) => {
                        console.log(`   Albarán ${index + 1}:`);
                        console.log(`     Página: ${item.pag}`);
                        console.log(`     Departamento: ${item.departamento || 'N/A'}`);
                        console.log(`     Número Orden: ${item.numeroOrden || 'N/A'}`);
                        console.log(`     Número Recibo: ${item.numeroRecibo || 'N/A'}`);
                        console.log(`     Total: ${item.total || 'N/A'}`);
                        console.log(`     Error: ${item.statusError ? 'Sí' : 'No'}`);
                        if (item.mensaje) {
                            console.log(`     Mensaje: ${item.mensaje}`);
                        }
                        console.log('');
                    });
                }
                
                // Guardar resultado para comparación
                const resultPath = path.join(__dirname, 'test-polling-result.json');
                fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
                console.log(`💾 Resultado guardado en: ${resultPath}`);
                
            } catch (resultErr) {
                console.error(`❌ Error obteniendo resultado:`, resultErr.response?.data || resultErr.message);
            }
            
        } else if (currentStatus === 'error') {
            console.log('❌ Procesamiento falló. Obteniendo detalles del error...');
            
            try {
                const resultResponse = await axios.get(`${BASE_URL}/api/result/${requestId}`);
                console.log('Error:', resultResponse.data);
            } catch (resultErr) {
                console.error('Error obteniendo detalles:', resultErr.response?.data || resultErr.message);
            }
            
        } else {
            console.log(`⏰ Timeout: Procesamiento aún en curso después de ${maxPolls} intentos.`);
            console.log(`   Estado final: ${currentStatus}`);
        }

        console.log('\n🏁 Test completado.');

    } catch (err) {
        console.error('❌ Error en test de polling:', err.response?.data || err.message);
    }
}

/**
 * Test del endpoint de jobs (debugging)
 */
async function testJobsEndpoint() {
    console.log('\n🔍 Testing endpoint de jobs...');
    
    try {
        const response = await axios.get(`${BASE_URL}/api/jobs`);
        const data = response.data;
        
        console.log('✅ Jobs endpoint funcional:');
        console.log(`   Estadísticas:`, data.stats);
        console.log(`   Jobs activos: ${data.jobs.length}`);
        
        if (data.jobs.length > 0) {
            console.log('\n📋 Jobs activos:');
            data.jobs.forEach((job, index) => {
                console.log(`   Job ${index + 1}:`);
                console.log(`     RequestId: ${job.requestId}`);
                console.log(`     Status: ${job.status}`);
                console.log(`     Creado: ${job.createdAt}`);
                console.log(`     Progress: ${job.progress || 'N/A'}`);
                console.log('');
            });
        }
        
    } catch (err) {
        console.error('❌ Error en jobs endpoint:', err.response?.data || err.message);
    }
}

/**
 * Test del endpoint de salud
 */
async function testHealthEndpoint() {
    console.log('\n🏥 Testing endpoint de salud...');
    
    try {
        const response = await axios.get(`${BASE_URL}/health`);
        const data = response.data;
        
        console.log('✅ Health endpoint funcional:');
        console.log(`   Tesseract: ${data.tesseract ? '✅' : '❌'}`);
        console.log(`   Poppler: ${data.poppler ? '✅' : '❌'}`);
        console.log(`   Disk Space: ${data.diskSpaceOK ? '✅' : '❌'}`);
        
    } catch (err) {
        console.error('❌ Error en health endpoint:', err.response?.data || err.message);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Ejecutar tests
async function runAllTests() {
    await testHealthEndpoint();
    await testJobsEndpoint();
    await testPollingWorkflow();
}

if (require.main === module) {
    runAllTests().catch(console.error);
}

module.exports = {
    testPollingWorkflow,
    testJobsEndpoint,
    testHealthEndpoint
};