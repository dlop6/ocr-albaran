const fs = require('fs');
const path = require('path');
const axios = require('axios');

const docsDir = path.join(__dirname, 'docs');
const resultsDir = path.join(__dirname, 'temp_results');
const endpoint = 'http://localhost:3000/api/process-pdf';

// Crear carpeta de resultados si no existe
if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir);
}

async function pdfToBase64(pdfPath) {
    const buffer = fs.readFileSync(pdfPath);
    return buffer.toString('base64');
}

async function processAllPdfs() {
    const exclude = [
        'RV 9294603525.pdf',
        'albaran español baja calidad.pdf'
    ];
    const files = fs.readdirSync(docsDir)
        .filter(f => f.toLowerCase().endsWith('.pdf'))
        .filter(f => !exclude.includes(f));
    for (const file of files) {
        const pdfPath = path.join(docsDir, file);
        console.log(`Procesando: ${file}`);
        try {
            const pdfBase64 = await pdfToBase64(pdfPath);
            const response = await axios.post(endpoint, { pdfBase64 });
            const resultPath = path.join(resultsDir, file.replace(/\.pdf$/i, '.json'));
            fs.writeFileSync(resultPath, JSON.stringify(response.data, null, 2));
            console.log(`Guardado: ${resultPath}`);
        } catch (err) {
            console.error(`Error procesando ${file}:`);
            if (err.response) {
                console.error('Status:', err.response.status);
                console.error('Data:', err.response.data);
            } else {
                console.error('Error:', err.stack || err);
            }
        }
    }
    console.log('Procesamiento batch finalizado.');
}

processAllPdfs();
