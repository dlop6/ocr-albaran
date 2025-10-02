const fs = require('fs');
const axios = require('axios');

const BASE_URL = 'https://ocr-albaranes.mangotree-243a6af9.westus2.azurecontainerapps.io';
const pdfBase64 = fs.readFileSync('temp_pdf_base64.txt', 'utf8').trim();

async function main() {
  try {
    // 1. Iniciar proceso
    const startRes = await axios.post(`${BASE_URL}/api/start-process`, {
      pdfBase64,
      idioma: 'ING',
      albaranesEsperados: 1
    }, { headers: { 'Content-Type': 'application/json' } });
    const requestId = startRes.data.requestId;
    console.log('RequestId:', requestId);

    // 2. Polling status
    let status = startRes.data.status;
    let progress = '';
    let pollCount = 0;
    while (status !== 'completed' && status !== 'error') {
      await new Promise(r => setTimeout(r, 10000)); // 10s entre polls
      pollCount++;
      const statusRes = await axios.get(`${BASE_URL}/api/status/${requestId}`);
      status = statusRes.data.status;
      progress = statusRes.data.progress || '';
      console.log(`Poll #${pollCount}: status=${status}, progress=${progress}`);
    }

    // 3. Obtener resultado
    const resultRes = await axios.get(`${BASE_URL}/api/result/${requestId}`);
    fs.writeFileSync('test-polling-azure-result.json', JSON.stringify(resultRes.data, null, 2));
    console.log('Resultado guardado en test-polling-azure-result.json');
  } catch (err) {
    if (err.response) {
      console.error('Error:', err.response.status, err.response.data);
    } else {
      console.error('Error:', err.message);
    }
  }
}

main();
