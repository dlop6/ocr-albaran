#!/usr/bin/env node

/**
 * Script de debug para diagnosticar problemas con el endpoint de job-status
 */

const fs = require('fs');

const API_URL = 'https://ocr-albaranes-polling-latest.onrender.com';

async function debugJobStatus() {
    console.log('🔍 Diagnóstico del endpoint job-status');
    console.log('=====================================\n');

    try {
        // 1. Verificar salud del servidor
        console.log('1. Verificando salud del servidor...');
        const healthResponse = await fetch(`${API_URL}/health`);
        const healthData = await healthResponse.json();
        console.log('   ✅ Salud:', JSON.stringify(healthData, null, 2));

        // 2. Crear un trabajo simple
        console.log('\n2. Creando trabajo de prueba...');
        const pdfPath = './docs/albaran ingles.pdf';
        const pdfBuffer = fs.readFileSync(pdfPath);
        const pdfBase64 = pdfBuffer.toString('base64');

        const startResponse = await fetch(`${API_URL}/api/start-process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pdfBase64: pdfBase64,
                idioma: 'ING',
                albaranesEsperados: 1
            })
        });

        if (!startResponse.ok) {
            const error = await startResponse.json();
            throw new Error(`Error creando trabajo: ${JSON.stringify(error)}`);
        }

        const { jobId } = await startResponse.json();
        console.log(`   ✅ Trabajo creado: ${jobId}`);

        // 3. Consultar estado inmediatamente
        console.log('\n3. Consultando estado inmediatamente...');
        const immediate = await fetch(`${API_URL}/api/job-status/${jobId}`);
        console.log(`   Status: ${immediate.status}`);
        if (immediate.ok) {
            const data = await immediate.json();
            console.log(`   Datos:`, JSON.stringify(data, null, 2));
        } else {
            const error = await immediate.text();
            console.log(`   Error:`, error);
        }

        // 4. Consultar estado cada 2 segundos por 30 segundos
        console.log('\n4. Monitoreando estado...');
        for (let i = 0; i < 15; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const statusResponse = await fetch(`${API_URL}/api/job-status/${jobId}`);
            console.log(`   [${i*2+2}s] Status: ${statusResponse.status}`);
            
            if (statusResponse.ok) {
                const data = await statusResponse.json();
                console.log(`       Estado: ${data.status}`);
                
                if (['terminado', 'error'].includes(data.status)) {
                    console.log('   ✅ Trabajo terminado');
                    break;
                }
            } else {
                console.log(`   ❌ Error ${statusResponse.status}: ${await statusResponse.text()}`);
                break;
            }
        }

        // 5. Consultar resultado final
        console.log('\n5. Consultando resultado final...');
        const resultResponse = await fetch(`${API_URL}/api/job-result/${jobId}`);
        console.log(`   Status: ${resultResponse.status}`);
        if (resultResponse.ok) {
            const result = await resultResponse.json();
            console.log(`   Resultado:`, JSON.stringify(result, null, 2));
        } else {
            const error = await resultResponse.text();
            console.log(`   Error:`, error);
        }

    } catch (error) {
        console.error('💥 Error en diagnóstico:', error.message);
    }
}

debugJobStatus().catch(console.error);