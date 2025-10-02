const fs = require('fs');

/**
 * Test de diagnóstico para identificar el problema del worker
 */

const API_BASE_URL = 'https://ocr-albaranes-polling-latest.onrender.com';

async function debugTest() {
    console.log('🔍 Test de diagnóstico iniciado\n');

    try {
        // Crear PDF mínimo válido en base64
        const minimalPdf = 'JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwKL0xlbmd0aCAzIDAgUgovRmlsdGVyIC9GbGF0ZURlY29kZQo+PgpzdHJlYW0KeJxLy8wpTVWwUshIzcnPS1WwUsrPS8vMSQUABiUIFA==';

        console.log('📤 Enviando PDF mínimo...');
        
        const payload = {
            pdfBase64: minimalPdf,
            idioma: 'ESP',
            albaranesEsperados: 1
        };

        const response = await fetch(`${API_BASE_URL}/api/start-process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Error creando trabajo: ${errorData.error}`);
        }

        const { jobId } = await response.json();
        console.log(`✅ Trabajo creado: ${jobId}\n`);

        // Monitoreo intensivo cada 1 segundo por 30 segundos
        for (let i = 0; i < 30; i++) {
            try {
                const statusResponse = await fetch(`${API_BASE_URL}/api/job-status/${jobId}`);
                
                if (statusResponse.ok) {
                    const statusData = await statusResponse.json();
                    console.log(`[${i + 1}s] ✅ Estado: ${statusData.status}`);
                    
                    if (statusData.status === 'terminado' || statusData.status === 'error') {
                        console.log('\n🎯 Trabajo terminado, obteniendo resultado...');
                        
                        const resultResponse = await fetch(`${API_BASE_URL}/api/job-result/${jobId}`);
                        const result = await resultResponse.json();
                        console.log('📊 Resultado:', JSON.stringify(result, null, 2));
                        break;
                    }
                } else {
                    console.log(`[${i + 1}s] ❌ Error ${statusResponse.status} - Trabajo perdido`);
                    
                    // Intentar obtener stats del sistema
                    try {
                        const statsResponse = await fetch(`${API_BASE_URL}/health`);
                        if (statsResponse.ok) {
                            const stats = await statsResponse.json();
                            console.log('🔧 Stats del sistema:', JSON.stringify(stats, null, 2));
                        }
                    } catch (e) {
                        console.log('⚠️ No se pudieron obtener stats del sistema');
                    }
                    break;
                }
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.log(`[${i + 1}s] 💥 Error de red: ${error.message}`);
                break;
            }
        }

    } catch (error) {
        console.error('💥 Error en test de diagnóstico:', error.message);
    }
}

debugTest().catch(console.error);