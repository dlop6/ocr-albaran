#!/usr/bin/env node
"use strict";

const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');
const pdfService = require('../src/pdfService');
const ocrService = require('../src/ocrService');

// Minimal argv parsing
const rawArgs = process.argv.slice(2);
const argv = {};
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--pdf' && rawArgs[i + 1]) { argv.pdf = rawArgs[i + 1]; i++; }
  else if (a === '--page' && rawArgs[i + 1]) { argv.page = Number(rawArgs[i + 1]); i++; }
  else if (a === '--angle' && rawArgs[i + 1]) { argv.angle = Number(rawArgs[i + 1]); i++; }
  else if (a === '--lang' && rawArgs[i + 1]) { argv.lang = rawArgs[i + 1]; i++; }
}
if (!argv.pdf || !argv.page || typeof argv.angle !== 'number') {
  console.error('Usage: node extract_page_ocr.js --pdf <path> --page <n> --angle <deg> [--lang <spa|eng>]');
  process.exit(2);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const pdfPath = path.isAbsolute(argv.pdf) ? argv.pdf : path.join(repoRoot, argv.pdf);
  if (!fs.existsSync(pdfPath)) {
    console.error(`PDF not found: ${pdfPath}`);
    process.exit(2);
  }
  const outDir = path.join(__dirname, 'results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const tmpDir = path.join(os.tmpdir(), `extract_page_ocr_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPages().length;
    const p = argv.page;
    if (p < 1 || p > pageCount) {
      console.error(`Invalid page number ${p}. PDF has ${pageCount} pages.`);
      process.exit(3);
    }
    const singlePdf = await PDFDocument.create();
    const [copied] = await singlePdf.copyPages(pdfDoc, [p - 1]);
    singlePdf.addPage(copied);
    const singleBytes = await singlePdf.save();
    const singlePdfPath = path.join(tmpDir, `page-${p}-single.pdf`);
    fs.writeFileSync(singlePdfPath, singleBytes);

    // Extraer la página como imagen
    const imgs = await pdfService.extractPagesAsImages(singlePdfPath, tmpDir, 1);
    if (!imgs || imgs.length === 0 || !imgs[0]) {
      console.error('No image produced. Check that pdftocairo is installed and in PATH.');
      process.exit(4);
    }
    let imgPath = imgs[0];

    // Rotar la imagen según ángulo indicado
    const rotatedPath = await ocrService.rotateImage(imgPath, argv.angle);

    // Ejecutar OCR sobre la imagen rotada
    const lang = argv.lang || 'spa';
    const ocrResult = await ocrService.applyOcrToImage(rotatedPath, lang);
    if (!ocrResult || !ocrResult.text) {
      console.error('OCR no extrajo texto.');
      process.exit(5);
    }
    // Guardar resultado
    const outJson = path.join(outDir, `ocr-page${p}-angle${argv.angle}.json`);
    fs.writeFileSync(outJson, JSON.stringify({
      pdf: pdfPath,
      page: p,
      angle: argv.angle,
      lang,
      text: ocrResult.text,
      confidence: ocrResult.confidence || null
    }, null, 2), 'utf8');
    console.log(`OCR completado. Resultado guardado en: ${outJson}`);
    console.log('Texto extraído:\n');
    console.log(ocrResult.text);
    process.exit(0);
  } catch (err) {
    console.error('Error extracting/rotating/OCR page:', err.message || err);
    process.exit(1);
  } finally {
    // cleanup tmpDir
    try { if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
}

main();