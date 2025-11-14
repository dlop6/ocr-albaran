// Script de testing para la página 16 de docs/EJEMPLO 3.pdf
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const pdfService = require('../src/pdfService');
const ocrService = require('../src/ocrService');
const fieldExtractor = require('../src/fieldExtractor');
const logger = require('../src/logger');

// Parámetros configurables
const PDF_PATH = path.resolve(__dirname, '../docs/EJEMPLO 3.pdf');
const PAGE_NUMBER = 16; // 1-based
const DPI = process.env.OCR_DPI || '300';
const IDIOMA = process.env.TEST_IDIOMA || 'es'; // ISO 639: 'es' o 'en' (acepta 'ESP'/'ING' por compat)
const PREPROC = process.env.TEST_PREPROC === 'true'; // true/false

const tempDir = path.join(__dirname, 'temp_test');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

async function main() {
    logger.info(`Testing OCR for ${PDF_PATH}, página ${PAGE_NUMBER}, DPI=${DPI}, idioma=${IDIOMA}, preproc=${PREPROC}`);
    // Extraer solo la página 16 como imagen
    const pdfDoc = await pdfService.loadPdf(PDF_PATH);
    const pageCount = pdfService.getPageCount(pdfDoc);
    if (PAGE_NUMBER < 1 || PAGE_NUMBER > pageCount) {
        console.error(`Página ${PAGE_NUMBER} fuera de rango (1-${pageCount})`);
        return;
    }
    // Extraer la página como PDF temporal
    const tempSinglePdf = path.join(tempDir, `page-${PAGE_NUMBER}-single.pdf`);
    const newPdf = await require('pdf-lib').PDFDocument.create();
    const copiedPages = await newPdf.copyPages(pdfDoc, [PAGE_NUMBER - 1]);
    newPdf.addPage(copiedPages[0]);
    const newPdfBytes = await newPdf.save();
    fs.writeFileSync(tempSinglePdf, newPdfBytes);
    // Convertir la página a imagen PNG con el DPI deseado
    const tempImageDir = path.join(tempDir, 'images');
    if (!fs.existsSync(tempImageDir)) fs.mkdirSync(tempImageDir);
    const args = [
        '-png',
        '-r', DPI,
        '-f', '1',
        '-l', '1',
        tempSinglePdf,
        path.join(tempImageDir, 'page')
    ];
    const { spawnSync } = require('child_process');
    const proc = spawnSync('pdftocairo', args, { encoding: 'utf8' });
    if (proc.error) {
        console.error('Error ejecutando pdftocairo:', proc.error);
        return;
    }
    if (proc.stderr) {
        logger.warn(`[Poppler][stderr]: ${proc.stderr}`);
    }
    const imgPath = path.join(tempImageDir, 'page-1.png');
    if (!fs.existsSync(imgPath)) {
        console.error('No se generó la imagen para la página 16');
        return;
    }
    // Ejecutar OCR y extracción de campos
    // Mapear idioma de entrada (ISO) a código de Tesseract ('spa'|'eng')
    const t = (IDIOMA && String(IDIOMA).toLowerCase());
    const tesseractLang = (['en','eng','ing'].includes(t)) ? 'eng' : 'spa';
    let ocrResult;
    // Usar la función existente applyOcrToImage (usa tesseract.js internamente)
    ocrResult = await ocrService.applyOcrToImage(imgPath, tesseractLang, false);
    console.log('--- TEXTO OCR ---');
    console.log(ocrResult.text);
    console.log('--- CAMPOS EXTRAÍDOS ---');
    const campos = fieldExtractor.extractFieldsFromText(ocrResult.text, PAGE_NUMBER, IDIOMA);
    console.log(campos);
    // Limpieza opcional
    // fs.unlinkSync(tempSinglePdf);
    // fs.unlinkSync(imgPath);
}

main().catch(err => {
    console.error('Error en test_page16:', err);
});
