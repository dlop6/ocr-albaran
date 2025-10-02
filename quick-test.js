/**
 * Test rápido del sistema de polling OCR
 * Uso: node quick-test.js [ruta-al-pdf]
 */

const fs = require('fs');

// Configuración
const API_URL = process.env.API_URL || 'http://localhost:3000';
const PDF_PATH = process.argv[2] || './temp_pdf_base64.txt';

async function quickTest() {
    console.log('🚀 Test rápido del sistema de polling OCR');
    console.log(`📡 API: ${API_URL}`);
    console.log(`📄 PDF: ${PDF_PATH}\n`);

    try {
        // Cargar PDF base64
        let pdfBase64;
        if (PDF_PATH.endsWith('.txt')) {
            // Archivo de base64
            pdfBase64 = fs.readFileSync(PDF_PATH, 'utf8').trim();
        } else {
            // Archivo PDF directo
            const pdfBuffer = fs.readFileSync(PDF_PATH);
            pdfBase64 = pdfBuffer.toString('base64');
        }

        console.log(`📊 Tamaño: ${(pdfBase64.length * 0.75 / 1024 / 1024).toFixed(2)} MB`);

        // 1. Iniciar trabajo
        console.log('\n1️⃣ Iniciando trabajo...');
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
            throw new Error(`Error iniciando: ${error.error}`);
        }

        const { jobId } = await startResponse.json();
        console.log(`✅ Trabajo iniciado: ${jobId}`);

        // 2. Polling
        console.log('\n2️⃣ Haciendo polling...');
        let status = 'pendiente';
        let attempts = 0;

        while (status === 'pendiente' || status === 'procesando') {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000));

            const statusResponse = await fetch(`${API_URL}/api/job-status/${jobId}`);
            const statusData = await statusResponse.json();
            status = statusData.status;

            console.log(`   Intento ${attempts}: ${status}`);

            if (attempts > 60) { // 2 minutos máximo
                throw new Error('Timeout después de 2 minutos');
            }
        }

        // 3. Resultado
        console.log('\n3️⃣ Obteniendo resultado...');
        const resultResponse = await fetch(`${API_URL}/api/job-result/${jobId}`);
        const result = await resultResponse.json();

        console.log('\n📋 RESULTADO:');
        console.log(`   Páginas: ${result.paginasInput}`);
        console.log(`   Albaranes: ${result.albaranesExtraidos}`);
        console.log(`   Error: ${result.statusError ? 'SÍ' : 'NO'}`);
        console.log(`   Mensaje: ${result.mensaje}`);

        if (result.datos && result.datos.length > 0) {
            console.log('\n📊 DATOS EXTRAÍDOS:');
            result.datos.forEach((item, i) => {
                console.log(`   ${i + 1}. Pág ${item.pag}: Orden ${item.numeroOrden}, Recibo ${item.numeroRecibo}`);
            });
        }

        console.log('\n✅ Test completado exitosamente!');

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    quickTest();
}

module.exports = quickTest;