const fs = require('fs/promises');
const { constants } = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { spawn } = require('child_process');
const logger = require('./logger');
const { limit: concurrencyLimit } = require('./concurrency');

const DPI = process.env.OCR_DPI ? String(process.env.OCR_DPI) : '300';

async function ensureDir(dirPath) {
        await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(filePath) {
        if (!filePath) return false;
        try {
                await fs.access(filePath, constants.F_OK);
                return true;
        } catch (err) {
                return false;
        }
}

async function safeUnlink(filePath) {
        if (!filePath) return;
        try {
                await fs.unlink(filePath);
        } catch (err) {
                if (err && err.code !== 'ENOENT') {
                        logger.warn(`[CLEANUP] No se pudo eliminar ${filePath}: ${err.message}`);
                }
        }
}

async function runPdftocairo(args, pageNumber, context = 'normal') {
        return new Promise((resolve, reject) => {
                const proc = spawn('pdftocairo', args);
                let stdout = '';
                let stderr = '';
                proc.stdout.on('data', data => { stdout += data.toString(); });
                proc.stderr.on('data', data => { stderr += data.toString(); });
                proc.on('error', reject);
                proc.on('close', code => {
                        if (stdout) {
                                logger.info(`[Poppler][stdout][${context} página ${pageNumber}]: ${stdout}`);
                        }
                        if (stderr) {
                                logger.error(`[Poppler][stderr][${context} página ${pageNumber}]: ${stderr}`);
                        }
                        if (code !== 0) {
                                reject(new Error(`pdftocairo exited with code ${code}`));
                        } else {
                                resolve();
                        }
                });
        });
}

async function convertPage(pdfPath, outputDir, pageNumber) {
        const prefix = path.join(outputDir, 'page');
        const imagePath = path.join(outputDir, `page-${pageNumber}.png`);
        const args = [
                '-png',
                '-r', DPI,
                '-f', String(pageNumber),
                '-l', String(pageNumber),
                pdfPath,
                prefix
        ];
        await runPdftocairo(args, pageNumber);
        if (!(await pathExists(imagePath))) {
                throw new Error(`Image not generated for page ${pageNumber}: ${imagePath}`);
        }
        return imagePath;
}

function createPdfDocLoader(pdfPath) {
        let pdfBytesPromise = null;
        let pdfDocPromise = null;
        return async () => {
                if (!pdfDocPromise) {
                        if (!pdfBytesPromise) {
                                pdfBytesPromise = fs.readFile(pdfPath);
                        }
                        const bytes = await pdfBytesPromise;
                        pdfDocPromise = PDFDocument.load(bytes);
                }
                return pdfDocPromise;
        };
}

async function fallbackConvertSinglePage(pdfPath, outputDir, pageNumber, loadPdfDoc) {
        const tempSinglePdf = path.join(outputDir, `page-${pageNumber}-single.pdf`);
        try {
                        const pdfDoc = await loadPdfDoc();
                        const newPdf = await PDFDocument.create();
                        const copiedPages = await newPdf.copyPages(pdfDoc, [pageNumber - 1]);
                        newPdf.addPage(copiedPages[0]);
                        const newPdfBytes = await newPdf.save();
                        await fs.writeFile(tempSinglePdf, newPdfBytes);
                        const fallbackPrefix = path.join(outputDir, `page-${pageNumber}-single`);
                        const fallbackImgPath = path.join(outputDir, `page-${pageNumber}-single-1.png`);
                        const args = [
                                '-png',
                                '-r', DPI,
                                '-f', '1',
                                '-l', '1',
                                tempSinglePdf,
                                fallbackPrefix
                        ];
                        await runPdftocairo(args, pageNumber, 'fallback');
                        if (!(await pathExists(fallbackImgPath))) {
                                throw new Error(`Fallback image not generated for page ${pageNumber}: ${fallbackImgPath}`);
                        }
                        return fallbackImgPath;
        } finally {
                        await safeUnlink(tempSinglePdf);
        }
}

async function convertPageWithFallback(pdfPath, outputDir, pageNumber, loadPdfDoc) {
        try {
                return await convertPage(pdfPath, outputDir, pageNumber);
        } catch (err) {
                logger.error(`[Poppler] Error al convertir página ${pageNumber}: ${err}`);
                try {
                        return await fallbackConvertSinglePage(pdfPath, outputDir, pageNumber, loadPdfDoc);
                } catch (fallbackErr) {
                        logger.error(`[Fallback] Error al extraer/converter página ${pageNumber}: ${fallbackErr}`);
                        return null;
                }
        }
}

function buildPageTasks(pdfPath, outputDir, noPages, loadPdfDoc) {
        const tasks = [];
        let completed = 0;
        const total = noPages;
        for (let i = 1; i <= noPages; i++) {
                const pageNumber = i;
                const task = concurrencyLimit(async () => {
                        try {
                                return await convertPageWithFallback(pdfPath, outputDir, pageNumber, loadPdfDoc);
                        } finally {
                                completed++;
                                const percent = total > 0 ? ((completed / total) * 100).toFixed(1) : '100.0';
                                logger.info(`[Poppler] Progreso: ${percent}% (${completed}/${total})`);
                        }
                });
                tasks.push(task);
        }
        return tasks;
}

async function loadPdf(input) {
        if (Buffer.isBuffer(input)) {
                return PDFDocument.load(input);
        }
        if (typeof input === 'string') {
                const data = await fs.readFile(input);
                return PDFDocument.load(data);
        }
        throw new Error('Invalid PDF input');
}

function getPageCount(pdf) {
        return pdf.getPages().length;
}

async function extractPagesAsImages(pdfPath, outputDir, noPages) {
        await ensureDir(outputDir);
        const loadPdfDoc = createPdfDocLoader(pdfPath);
        const tasks = buildPageTasks(pdfPath, outputDir, noPages, loadPdfDoc);
        return Promise.all(tasks);
}

async function* extractPagesAsImagesStream(pdfPath, outputDir, noPages) {
        await ensureDir(outputDir);
        const loadPdfDoc = createPdfDocLoader(pdfPath);
        const tasks = buildPageTasks(pdfPath, outputDir, noPages, loadPdfDoc);
        for (const task of tasks) {
                try {
                        const result = await task;
                        yield result;
                } catch (err) {
                        logger.error(`[Stream] Error en tarea de página: ${err}`);
                        yield null;
                }
        }
}

async function cleanupTempImages(outputDir, retainPaths = new Set()) {
        if (!outputDir) return;
        try {
                const entries = await fs.readdir(outputDir, { withFileTypes: true });
                for (const entry of entries) {
                        const fullPath = path.join(outputDir, entry.name);
                        if (retainPaths.has(fullPath)) {
                                continue;
                        }
                        try {
                                if (entry.isDirectory()) {
                                        await fs.rm(fullPath, { recursive: true, force: true });
                                } else {
                                        await fs.unlink(fullPath);
                                }
                        } catch (err) {
                                if (err && err.code !== 'ENOENT') {
                                        logger.warn(`[CLEANUP] No se pudo eliminar ${fullPath}: ${err.message}`);
                                }
                        }
                }
                const remaining = await fs.readdir(outputDir);
                if (remaining.length === 0) {
                        await fs.rmdir(outputDir);
                }
        } catch (err) {
                if (err && err.code !== 'ENOENT') {
                        logger.warn(`[CLEANUP] No se pudo limpiar directorio ${outputDir}: ${err.message}`);
                }
        }
}

async function validatePdf(input) {
        try {
                if (Buffer.isBuffer(input)) {
                        await PDFDocument.load(input);
                } else if (typeof input === 'string') {
                        const data = await fs.readFile(input);
                        await PDFDocument.load(data);
                } else {
                        throw new Error('Invalid PDF input');
                }
                return true;
        } catch (err) {
                return false;
        }
}

module.exports = {
        loadPdf,
        getPageCount,
        extractPagesAsImages,
        extractPagesAsImagesStream,
        cleanupTempImages,
        validatePdf
};
