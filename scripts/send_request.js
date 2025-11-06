#!/usr/bin/env node
"use strict";


// Script: scripts/send_request.js
// Usage: node scripts/send_request.js [PDF_FILENAME] [IDIOMA] [ALBARANES_ESPERADOS]
// - If PDF_FILENAME is omitted, script lists all PDFs in docs/ and prompts for selection.
// - If IDIOMA or ALBARANES_ESPERADOS are omitted, prompts for them.
// - Always POSTs to http://localhost:3000/api/process-pdf
// - Saves response to scripts/results/<pdf_filename>.json


const fs = require('fs');
const path = require('path');
const axios = require('axios');
const readline = require('readline');


function usageAndExit(code = 1) {
  console.error('\nUsage: node scripts/send_request.js [PDF_FILENAME] [IDIOMA] [ALBARANES_ESPERADOS]');
  console.error('  If PDF_FILENAME is omitted, script lists all PDFs in docs/ and prompts for selection.');
  console.error('  IDIOMA must be ESP or ING');
  console.error('  ALBARANES_ESPERADOS is optional integer >= 0');
  process.exit(code);
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}


(async function main() {
  const argv = process.argv.slice(2);
  const repoRoot = path.resolve(__dirname, '..');
  const docsDir = path.join(repoRoot, 'docs');
  const resultsDir = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir);

  // List PDFs in docs/
  const pdfFiles = fs.readdirSync(docsDir).filter(f => f.toLowerCase().endsWith('.pdf'));
  let pdfFilename = argv[0];
  if (!pdfFilename || !pdfFiles.includes(pdfFilename)) {
    // Prompt for selection
    console.log('Select a PDF to process:');
    pdfFiles.forEach((f, i) => console.log(`  [${i + 1}] ${f}`));
    let idx = await prompt('Enter number of PDF to process: ');
    idx = Number(idx);
    if (!Number.isInteger(idx) || idx < 1 || idx > pdfFiles.length) {
      console.error('Invalid selection.');
      process.exit(1);
    }
    pdfFilename = pdfFiles[idx - 1];
  }
  const pdfPath = path.join(docsDir, pdfFilename);
  if (!fs.existsSync(pdfPath)) {
    console.error(`Error: PDF file not found at ${pdfPath}`);
    process.exit(2);
  }

  // Encode PDF to base64
  let pdfBase64;
  try {
    const pdfBuffer = fs.readFileSync(pdfPath);
    pdfBase64 = pdfBuffer.toString('base64');
  } catch (err) {
    console.error('Error reading or encoding PDF:', err.message);
    process.exit(3);
  }

  // Idioma
  let idiomaInput = argv[1];
  if (!idiomaInput) {
    idiomaInput = await prompt('Enter idioma (ESP or ING): ');
  }
  idiomaInput = String(idiomaInput).trim().toUpperCase();
  if (!['ESP', 'ING'].includes(idiomaInput)) {
    console.error(`Error: idioma must be 'ESP' or 'ING'. Received: ${idiomaInput}`);
    process.exit(4);
  }

  // albaranesEsperados
  let albaranesEsperados = argv[2];
  if (albaranesEsperados === undefined) {
    const ans = await prompt('Enter albaranesEsperados (integer >= 0, blank for none): ');
    if (ans.trim() !== '') albaranesEsperados = ans.trim();
  }
  if (albaranesEsperados !== undefined) {
    const n = Number(albaranesEsperados);
    if (!Number.isInteger(n) || n < 0) {
      console.error('Error: ALBARANES_ESPERADOS must be an integer >= 0 if provided');
      process.exit(5);
    }
    albaranesEsperados = n;
  } else {
    albaranesEsperados = undefined;
  }

  // Generate random caseId
  const caseId = Math.floor(Math.random() * 1000000) + 1;

  const payload = {
    pdfBase64,
    idioma: idiomaInput,
    caseId
  };
  if (typeof albaranesEsperados === 'number') payload.albaranesEsperados = albaranesEsperados;

  const endpoint = 'http://localhost:3000/api/process-pdf';
  console.log(`Sending request to ${endpoint} for PDF: ${pdfFilename} (caseId: ${caseId})`);

  try {
    const resp = await axios.post(endpoint, payload, { timeout: 0, maxContentLength: Infinity, maxBodyLength: Infinity });
    console.log('Response status:', resp.status);
    // Save response to scripts/results/<pdfFilename>.json
    const resultPath = path.join(resultsDir, pdfFilename.replace(/\.pdf$/i, '.json'));
    fs.writeFileSync(resultPath, JSON.stringify(resp.data, null, 2), { encoding: 'utf8' });
    console.log(`Response saved to ${resultPath}`);
    // Also print response
    console.log('Response data:');
    console.log(JSON.stringify(resp.data, null, 2));
  } catch (err) {
    if (err.response) {
      console.error('Server responded with error status:', err.response.status);
      console.error('Response body:', JSON.stringify(err.response.data, null, 2));
    } else if (err.request) {
      console.error('No response received. Is the server running on the expected URL?');
      console.error('Request error:', err.message);
    } else {
      console.error('Error building request:', err.message);
    }
    process.exit(6);
  }

})();
