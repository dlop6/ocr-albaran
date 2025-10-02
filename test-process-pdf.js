const fs = require('fs');
const axios = require('axios');

const pdfBase64 = fs.readFileSync('temp_pdf_base64.txt', 'utf8').trim();

async function testProcessPdf() {
  try {
    const response = await axios.post('http://localhost:3001/api/process-pdf', {
      pdfBase64,
      idioma: 'ING',
      albaranesEsperados: 1
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('Respuesta /api/process-pdf:', JSON.stringify(response.data, null, 2));
  } catch (err) {
    if (err.response) {
      console.error('Error:', err.response.status, err.response.data);
    } else {
      console.error('Error:', err.message);
    }
  }
}

testProcessPdf();
