#!/usr/bin/env node
"use strict";

// Lab script: scripts/lab_extract.js
// - Selecciona un PDF de docs/
// - Extrae imágenes (usando pdfService)
// - Permite filtrar páginas (blank auto-detect) o elegir páginas específicas
// - Ejecuta OSD/OCR reutilizando ocrService, extrae campos con fieldExtractor
// - Guarda resultado detallado en scripts/results/lab-<pdf>-<ts>.json

const fs = require('fs');
const path = require('path');
const pdfService = require('../src/pdfService');
const ocrService = require('../src/ocrService');
const fieldExtractor = require('../src/fieldExtractor');
const parser = require('../src/parser');
const isImageBlank = require('../src/utils/isImageBlank');
const { PDFDocument } = require('pdf-lib');
const readline = require('readline');
const os = require('os');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

function parsePageSelection(input, max) {
  input = String(input).trim();
  if (!input || input.toLowerCase() === 'all') return Array.from({ length: max }, (_, i) => i + 1);
  const parts = input.split(',').map(s => s.trim());
  const res = new Set();
  for (const p of parts) {
    if (/^\d+$/.test(p)) {
      const n = Number(p); if (n >= 1 && n <= max) res.add(n);
    } else if (/^(\d+)-(\d+)$/.test(p)) {
      const [_, a, b] = p.match(/(\d+)-(\d+)/);
      const ia = Number(a), ib = Number(b);
      for (let k = Math.max(1, ia); k <= Math.min(max, ib); k++) res.add(k);
    }
  }
  return Array.from(res).sort((a, b) => a - b);
}

(async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const docsDir = path.join(repoRoot, 'docs');
  const resultsDir = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  const pdfFiles = fs.readdirSync(docsDir).filter(f => f.toLowerCase().endsWith('.pdf'));
  if (pdfFiles.length === 0) {
    console.error('No PDFs found in docs/'); process.exit(1);
  }

  console.log('Available PDFs:'); pdfFiles.forEach((f, i) => console.log(` [${i+1}] ${f}`));
  const sel = await prompt('Select PDF number: ');
  const idx = Number(sel);
  if (!Number.isInteger(idx) || idx < 1 || idx > pdfFiles.length) { console.error('Invalid selection'); process.exit(1); }
  const pdfFilename = pdfFiles[idx - 1];
  const pdfPath = path.join(docsDir, pdfFilename);

  console.log(`Preparing to analyze ${pdfFilename} ...`);
  const tmpRoot = path.join(os.tmpdir(), `lab_imgs_${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });
  const pdfBuffer = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pageCount = pdfDoc.getPages().length;

  console.log('\n--- Parameters (you can accept defaults) ---');
  console.log('DPI: controls resolution given to pdftocairo. Higher DPI -> sharper images but slower and larger. Common values: 150, 200, 300 (default), 400.');
  const dpiAns = await prompt('DPI for image extraction (default 300): ');
  const dpi = dpiAns.trim() ? Number(dpiAns) : 300;
  process.env.OCR_DPI = String(dpi);

  console.log('\nBlank detection threshold percent: percentage of pixels considered "white" to mark a page as blank.');
  console.log('Higher value => stricter (only pages that are almost all white are discarded). Typical: 95-99.');
  const blankThresholdAns = await prompt('Blank detection threshold percent (default 98): ');
  const blankThreshold = blankThresholdAns.trim() ? Number(blankThresholdAns) : 98;

  console.log('\nUse OSD (orientation detection + rotation) before OCR?');
  console.log('If NO, OCR will run directly on the image (faster) but rotated pages may fail.');
  const useOSDAns = await prompt('Use OSD? (yes/no, default yes): ');
  const useOSD = (useOSDAns.trim() === '' ? 'yes' : useOSDAns).toLowerCase().startsWith('y');

  console.log('\nNumbers-only mode: restrict OCR character whitelist to digits (useful for invoice numbers).');
  const numbersOnlyAns = await prompt('Numbers-only OCR? (yes/no, default no): ');
  const numbersOnly = numbersOnlyAns.trim().toLowerCase().startsWith('y');

  console.log('\nIdioma affects tesseract language model. Use ISO codes (es/en) or ESP/ING for compatibility.');
  const idiomaAns = await prompt("Idioma (es/en, default 'es'): ");
  const idiomaRaw = (idiomaAns.trim() ? idiomaAns.trim() : 'es');
  const idioma = String(idiomaRaw).toLowerCase();
  const tesseractLang = (['en','eng','ing'].includes(idioma)) ? 'eng' : 'spa';

  const pageSelAns = await prompt('Pages to analyze (e.g. 1,3,5-7 or all): ');
  const desiredPages = parsePageSelection(pageSelAns || 'all', pageCount);

  // Detect blank pages but do it only for desiredPages (to avoid converting all pages)
  const paginasBlancas = [];
  const pagesToAnalyze = [];

  for (const p of desiredPages) {
    // Create a single-page PDF for page p
    const singleDir = path.join(tmpRoot, `page_${p}`);
    fs.mkdirSync(singleDir, { recursive: true });
    const singlePdfPath = path.join(singleDir, `page-${p}-single.pdf`);
    const newPdf = await PDFDocument.create();
    const [copied] = await newPdf.copyPages(await PDFDocument.load(pdfBuffer), [p - 1]);
    newPdf.addPage(copied);
    const newPdfBytes = await newPdf.save();
    fs.writeFileSync(singlePdfPath, newPdfBytes);

    // Convert only this single PDF page to image
    const imgs = await pdfService.extractPagesAsImages(singlePdfPath, singleDir, 1);
    const imagePath = imgs && imgs[0] ? imgs[0] : null;
    let isBlank = false;
    if (imagePath) {
      try { isBlank = await isImageBlank(imagePath, 240, blankThreshold); } catch (err) { console.warn('blank detection error', err.message); }
    }
    if (isBlank) {
      paginasBlancas.push(p);
      // cleanup image and singlePdf
      try { if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath); } catch (e) {}
      try { if (fs.existsSync(singlePdfPath)) fs.unlinkSync(singlePdfPath); } catch (e) {}
    } else {
      pagesToAnalyze.push({ page: p, imagePath, singlePdfPath, singleDir });
    }
  }

  console.log('Detected blank pages (within selection):', paginasBlancas.join(', ') || '(none)');
  console.log('Pages that will be analyzed:', pagesToAnalyze.map(x => x.page).join(', ') || '(none)');

  const results = { pdf: pdfFilename, pageCount, paginasBlancas, analyzed: [] };

  for (const item of pagesToAnalyze) {
    const p = item.page;
    let imagePath = item.imagePath;
    console.log(`Analyzing page ${p} ...`);
    const start = process.hrtime();
    let ocrResult = null;
    try {
      if (useOSD) {
        // Use OSD to detect rotation, then run applyOcrToImage with numbersOnly option
        const angle = await ocrService.detectOrientationWithOSD(imagePath);
        let imgToProcess = imagePath;
        if (angle !== null && angle !== 0) {
          imgToProcess = await ocrService.rotateImage(imagePath, angle);
        }
        ocrResult = await ocrService.applyOcrToImage(imgToProcess, tesseractLang, numbersOnly);
        // If we created a rotated image, cleanup it
        if (imgToProcess !== imagePath) {
          try { if (fs.existsSync(imgToProcess)) fs.unlinkSync(imgToProcess); } catch (e) {}
        }
      } else {
        // Direct OCR without OSD/rotation
        ocrResult = await ocrService.applyOcrToImage(imagePath, tesseractLang, numbersOnly);
      }
    } catch (err) {
      console.warn(`Error during OCR on page ${p}: ${err.message}`);
    }
    const elapsed = process.hrtime(start); const timeSeconds = elapsed[0] + elapsed[1] / 1e9;
    const text = ocrResult ? ocrResult.text : '';
    const fields = fieldExtractor.extractFieldsFromText(text, p, idioma);
    results.analyzed.push({ page: p, timeSeconds, ocr: ocrResult, fields });
    // cleanup page artifacts
    try { if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath); } catch (e) {}
    try { if (fs.existsSync(item.singlePdfPath)) fs.unlinkSync(item.singlePdfPath); } catch (e) {}
    try { if (fs.existsSync(item.singleDir)) fs.rmdirSync(item.singleDir); } catch (e) {}
  }

  // Save results
  const outPath = path.join(resultsDir, `lab-${pdfFilename.replace(/\.pdf$/i, '')}-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Lab results saved to ${outPath}`);

  // Cleanup tmp images
  try { await pdfService.cleanupTempImages(tmpDir); } catch (e) { /* ignore */ }
  process.exit(0);

})();
