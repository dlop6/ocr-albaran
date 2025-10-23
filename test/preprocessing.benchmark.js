const path = require('path');
const fs = require('fs');
const os = require('os');
const { performance } = require('perf_hooks');
const sharp = require('sharp');
const { spawnSync } = require('child_process');

const pdfService = require('../src/pdfService');
const ocrService = require('../src/ocrService');
const logger = require('../src/logger');

const SAMPLE_PDFS = [
  { name: 'EJEMPLO 1', file: 'EJEMPLO 1.pdf', pages: 2 },
  { name: 'EJEMPLO 3', file: 'EJEMPLO 3.pdf', pages: 2 },
  { name: 'Albaran baja calidad', file: 'albaran español baja calidad.pdf', pages: 1 }
];

async function legacyPreprocess(imagePath) {
  return sharp(imagePath)
    .resize({ width: 2000 })
    .sharpen({ sigma: 1.0 })
    .normalize()
    .png()
    .toBuffer();
}

async function runBenchmark() {
  const popplerCheck = spawnSync('pdftocairo', ['-v'], { encoding: 'utf8' });
  if (popplerCheck.error && popplerCheck.error.code === 'ENOENT') {
    console.warn('[PRE BENCH] pdftocairo no está disponible; se omite el benchmark de tiempos.');
    return;
  }

  const repoDocs = path.resolve(__dirname, '..', 'docs');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-bench-'));
  const summary = [];

  try {
    for (const sample of SAMPLE_PDFS) {
      const pdfPath = path.join(repoDocs, sample.file);
      if (!fs.existsSync(pdfPath)) {
        logger.warn(`[PRE BENCH] PDF ${sample.file} no encontrado, se omite.`);
        continue;
      }
      const outputDir = path.join(tempRoot, sample.name.replace(/\s+/g, '_'));
      fs.mkdirSync(outputDir, { recursive: true });
      const pdfDoc = await pdfService.loadPdf(pdfPath);
      const pageCount = pdfService.getPageCount(pdfDoc);
      const pagesToExtract = Math.min(sample.pages || 1, pageCount);
      const imagePaths = await pdfService.extractPagesAsImages(pdfPath, outputDir, pagesToExtract);
      for (let idx = 0; idx < imagePaths.length; idx++) {
        const imagePath = imagePaths[idx];
        if (!imagePath || !fs.existsSync(imagePath)) continue;
        const legacyStart = performance.now();
        await legacyPreprocess(imagePath);
        const legacyMs = performance.now() - legacyStart;

        const modernStart = performance.now();
        const preprocessResult = await ocrService.preprocessImage(imagePath);
        const modernMs = performance.now() - modernStart;

        summary.push({
          pdf: sample.name,
          page: idx + 1,
          legacyMs,
          modernMs,
          ratio: modernMs / legacyMs
        });

        // liberar buffers explícitamente
        if (preprocessResult) {
          preprocessResult.processed = null;
          preprocessResult.binarized = null;
        }
      }
      // limpiar imágenes generadas para este PDF
      try {
        fs.rmSync(outputDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        logger.warn(`[PRE BENCH] Error limpiando directorio ${outputDir}: ${cleanupErr.message}`);
      }
    }
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (err) {
      // ignore
    }
  }

  console.log('=== Benchmark de preprocesamiento ===');
  for (const row of summary) {
    console.log(`${row.pdf} - Página ${row.page}: legacy ${row.legacyMs.toFixed(1)}ms vs nuevo ${row.modernMs.toFixed(1)}ms (ratio ${row.ratio.toFixed(2)})`);
  }
  const legacyAvg = summary.reduce((sum, row) => sum + row.legacyMs, 0) / (summary.length || 1);
  const modernAvg = summary.reduce((sum, row) => sum + row.modernMs, 0) / (summary.length || 1);
  console.log(`Promedio legacy: ${legacyAvg.toFixed(1)}ms, promedio nuevo: ${modernAvg.toFixed(1)}ms, ratio promedio ${(modernAvg / legacyAvg).toFixed(2)}`);
}

if (require.main === module) {
  runBenchmark().catch(err => {
    console.error('Benchmark falló:', err);
    process.exit(1);
  });
}

module.exports = { runBenchmark };
