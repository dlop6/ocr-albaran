#!/usr/bin/env node
"use strict";

const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');
const pdfService = require('../src/pdfService');

// Minimal argv parsing to avoid extra dependency
const rawArgs = process.argv.slice(2);
const argv = {};
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--pdf' && rawArgs[i + 1]) { argv.pdf = rawArgs[i + 1]; i++; }
  else if (a === '--page' && rawArgs[i + 1]) { argv.page = Number(rawArgs[i + 1]); i++; }
  else if (a === '--out' && rawArgs[i + 1]) { argv.out = rawArgs[i + 1]; i++; }
}
if (!argv.pdf || !argv.page) {
  console.error('Usage: node extract_page.js --pdf <path> --page <n> [--out <dir>]');
  process.exit(2);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const pdfPath = path.isAbsolute(argv.pdf) ? argv.pdf : path.join(repoRoot, argv.pdf);
  if (!fs.existsSync(pdfPath)) {
    console.error(`PDF not found: ${pdfPath}`);
    process.exit(2);
  }
  const outDir = argv.out ? path.resolve(argv.out) : path.join(__dirname, 'results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const tmpDir = path.join(os.tmpdir(), `extract_page_${Date.now()}`);
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

    // Extract the single page to image(s)
    const imgs = await pdfService.extractPagesAsImages(singlePdfPath, outDir, 1);
    if (!imgs || imgs.length === 0 || !imgs[0]) {
      console.error('No image produced. Check that pdftocairo is installed and in PATH.');
      process.exit(4);
    }
    console.log(`Image generated: ${imgs[0]}`);
    process.exit(0);
  } catch (err) {
    console.error('Error extracting page:', err.message || err);
    process.exit(1);
  } finally {
    // cleanup tmpDir (leave images in outDir)
    try { if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
}

main();
