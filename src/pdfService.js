// DPI configurable desde .env
const DPI = process.env.OCR_DPI ? String(process.env.OCR_DPI) : '300';

const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");
const { spawn } = require('child_process');
const logger = require('./logger');

const DEFAULT_PAGE_BATCH_SIZE = (() => {
        const env = process.env.PDF_PAGE_BATCH_SIZE;
        if (env) {
                const n = parseInt(env, 10);
                if (!Number.isNaN(n) && n > 0) {
                        return n;
                }
        }
        return 4;
})();

function determineBatchSize(totalPages) {
        if (totalPages <= 1) {
                return 1;
        }
        return Math.min(DEFAULT_PAGE_BATCH_SIZE, totalPages);
}

function ensureOutputDir(dir) {
        if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
        }
}

function readPdfBuffer(pdfPath, providedBuffer) {
        if (providedBuffer && Buffer.isBuffer(providedBuffer)) {
                return providedBuffer;
        }
        return fs.readFileSync(pdfPath);
}

function createPdfDocLoader(pdfBuffer) {
        let pdfDocPromise = null;
        return async () => {
                if (!pdfDocPromise) {
                        pdfDocPromise = PDFDocument.load(pdfBuffer);
                }
                return pdfDocPromise;
        };
}

function runPdftocairo(args, label) {
        return new Promise((resolve, reject) => {
                const proc = spawn('pdftocairo', args);
                let stdout = '';
                let stderr = '';

                proc.stdout.on('data', data => {
                        stdout += data.toString();
                });
                proc.stderr.on('data', data => {
                        stderr += data.toString();
                });

                proc.on('error', err => {
                        reject(err);
                });

                proc.on('close', code => {
                        if (stdout) {
                                logger.info(`[Poppler][stdout][${label}]: ${stdout}`);
                        }
                        if (stderr) {
                                logger.error(`[Poppler][stderr][${label}]: ${stderr}`);
                        }
                        if (code !== 0) {
                                reject(new Error(`pdftocairo exited with code ${code}`));
                        } else {
                                resolve();
                        }
                });
        });
}

async function convertSinglePageFallback({ page, pdfPath, outputDir, pdfBuffer, pdfDocLoader, onPageSuccess, onPageFailure }) {
        const label = `fallback página ${page}`;
        try {
                const pdfDoc = await pdfDocLoader();
                const newPdf = await PDFDocument.create();
                const copiedPages = await newPdf.copyPages(pdfDoc, [page - 1]);
                newPdf.addPage(copiedPages[0]);
                const newPdfBytes = await newPdf.save();

                const tempSinglePdf = path.join(outputDir, `page-${page}-single.pdf`);
                fs.writeFileSync(tempSinglePdf, newPdfBytes);

                const args = [
                        '-png',
                        '-r', DPI,
                        '-f', '1',
                        '-l', '1',
                        tempSinglePdf,
                        path.join(outputDir, `page-${page}-single`)
                ];

                const startTime = process.hrtime.bigint();
                await runPdftocairo(args, label);
                const endTime = process.hrtime.bigint();
                const rasterSeconds = Number(endTime - startTime) / 1e9;

                const fallbackImgPath = path.join(outputDir, `page-${page}-single-1.png`);
                if (!fs.existsSync(fallbackImgPath)) {
                        throw new Error(`Fallback image not generated for page ${page}: ${fallbackImgPath}`);
                }

                try {
                        if (fs.existsSync(tempSinglePdf)) {
                                fs.unlinkSync(tempSinglePdf);
                        }
                } catch (cleanupErr) {
                        logger.warn(`[Fallback] No se pudo eliminar PDF temporal para página ${page}: ${cleanupErr}`);
                }

                if (onPageSuccess) {
                        await onPageSuccess(page, fallbackImgPath, {
                                rasterSeconds,
                                fallback: true,
                                rangeStart: page,
                                rangeEnd: page
                        });
                }
        } catch (err) {
                logger.error(`[Fallback] Error al extraer/convertir página ${page}: ${err}`);
                if (onPageFailure) {
                        await onPageFailure(page, err);
                } else if (onPageSuccess) {
                        await onPageSuccess(page, null, {
                                rasterSeconds: 0,
                                fallback: true,
                                rangeStart: page,
                                rangeEnd: page,
                                error: err
                        });
                }
        }
}

async function convertPageRange({
        pdfPath,
        outputDir,
        start,
        end,
        pdfBuffer,
        pdfDocLoader,
        onPageSuccess,
        onPageFailure
}) {
        const label = start === end ? `página ${start}` : `rango ${start}-${end}`;
        const args = [
                '-png',
                '-r', DPI,
                '-f', String(start),
                '-l', String(end),
                pdfPath,
                path.join(outputDir, 'page')
        ];

        logger.debug(`[Poppler] Iniciando rasterización ${label}`);
        const startTime = process.hrtime.bigint();
        try {
                await runPdftocairo(args, label);
        } catch (err) {
                const elapsed = Number(process.hrtime.bigint() - startTime) / 1e9;
                logger.error(`[Poppler] Error rasterizando ${label} tras ${elapsed.toFixed(3)}s: ${err}`);
                for (let page = start; page <= end; page++) {
                        await convertSinglePageFallback({
                                page,
                                pdfPath,
                                outputDir,
                                pdfBuffer,
                                pdfDocLoader,
                                onPageSuccess,
                                onPageFailure
                        });
                }
                return;
        }

        const totalSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
        logger.info(`[Poppler] Rasterización ${label} completada en ${totalSeconds.toFixed(3)}s`);
        const perPageSeconds = totalSeconds / (end - start + 1);

        for (let page = start; page <= end; page++) {
                const imgPath = path.join(outputDir, `page-${page}.png`);
                if (fs.existsSync(imgPath)) {
                        if (onPageSuccess) {
                                await onPageSuccess(page, imgPath, {
                                        rasterSeconds: perPageSeconds,
                                        fallback: false,
                                        rangeStart: start,
                                        rangeEnd: end
                                });
                        }
                } else {
                        logger.warn(`[Poppler] Imagen no encontrada para página ${page} tras rasterización ${label}. Iniciando fallback.`);
                        await convertSinglePageFallback({
                                page,
                                pdfPath,
                                outputDir,
                                pdfBuffer,
                                pdfDocLoader,
                                onPageSuccess,
                                onPageFailure
                        });
                }
        }
}


// carga el archivo
async function loadPdf(input) {
	if (Buffer.isBuffer(input)) {
		return await PDFDocument.load(input);
	} else if (typeof input === "string") {
		return await PDFDocument.load(fs.readFileSync(input));
	}
	throw new Error("Invalid PDF input");
}

// Devuelve el número de páginas del PDF
function getPageCount(pdf) {
	return pdf.getPages().length;
}

// Convierte cada página en imagen y guarda en outputDir
// pdfPath: ruta al archivo PDF
// noPages: número de páginas
async function extractPagesAsImages(pdfPath, outputDir, noPages, options = {}) {
        ensureOutputDir(outputDir);
        const { pdfBuffer: providedBuffer } = options;
        const pdfBuffer = readPdfBuffer(pdfPath, providedBuffer);
        const pdfDocLoader = createPdfDocLoader(pdfBuffer);
        const results = new Array(noPages).fill(null);
        const errors = [];
        const total = noPages;
        let completed = 0;

        const updateProgress = () => {
                completed++;
                const percent = ((completed / total) * 100).toFixed(1);
                logger.info(`[Poppler] Progreso: ${percent}% (${completed}/${total})`);
        };

        const { limit: concurrencyLimit } = require('./concurrency');
        const limit = concurrencyLimit;

        const onPageSuccess = async (page, imagePath) => {
                results[page - 1] = imagePath;
                updateProgress();
        };

        const onPageFailure = async (page, err) => {
                results[page - 1] = null;
                errors.push({ page, err });
                updateProgress();
        };

        const batchSize = determineBatchSize(noPages);
        const tasks = [];
        for (let start = 1; start <= noPages; start += batchSize) {
                const end = Math.min(noPages, start + batchSize - 1);
                tasks.push(limit(() => convertPageRange({
                        pdfPath,
                        outputDir,
                        start,
                        end,
                        pdfBuffer,
                        pdfDocLoader,
                        onPageSuccess,
                        onPageFailure
                })));
        }

        await Promise.all(tasks);

        if (errors.length > 0) {
                logger.warn(`[Poppler] ${errors.length} páginas no se pudieron rasterizar correctamente en la pasada principal.`);
        }

        return results;
}

// Streaming extractor: async generator que va entregando cada imagen tan pronto se crea.
// Permite empezar OCR sin esperar a que todas las imágenes estén generadas.
async function* extractPagesAsImagesStream(pdfPath, outputDir, noPages, options = {}) {
        ensureOutputDir(outputDir);
        const { pdfBuffer: providedBuffer } = options;
        const pdfBuffer = readPdfBuffer(pdfPath, providedBuffer);
        const pdfDocLoader = createPdfDocLoader(pdfBuffer);
        const { limit: concurrencyLimit } = require('./concurrency');
        const limit = concurrencyLimit;

        const controllers = Array.from({ length: noPages }, () => {
                let resolve;
                const promise = new Promise((res) => {
                        resolve = res;
                });
                return { promise, resolve };
        });

        const onPageSuccess = async (page, imagePath, meta = {}) => {
                const controller = controllers[page - 1];
                if (!controller) {
                        return;
                }
                controller.resolve({
                        pageNumber: page,
                        imagePath,
                        rasterTimeSeconds: typeof meta.rasterSeconds === 'number' ? meta.rasterSeconds : null,
                        fallback: Boolean(meta.fallback),
                        rangeStart: meta.rangeStart,
                        rangeEnd: meta.rangeEnd,
                        error: meta.error || null
                });
        };

        const onPageFailure = async (page, error) => {
                const controller = controllers[page - 1];
                if (!controller) {
                        return;
                }
                controller.resolve({
                        pageNumber: page,
                        imagePath: null,
                        rasterTimeSeconds: null,
                        fallback: true,
                        rangeStart: page,
                        rangeEnd: page,
                        error: error || new Error(`No image generated for page ${page}`)
                });
        };

        const batchSize = determineBatchSize(noPages);
        const tasks = [];
        for (let start = 1; start <= noPages; start += batchSize) {
                const end = Math.min(noPages, start + batchSize - 1);
                tasks.push(limit(() => convertPageRange({
                        pdfPath,
                        outputDir,
                        start,
                        end,
                        pdfBuffer,
                        pdfDocLoader,
                        onPageSuccess,
                        onPageFailure
                })));
        }

        for (let index = 0; index < controllers.length; index++) {
                let result;
                try {
                        result = await controllers[index].promise;
                } catch (err) {
                        logger.error(`[Stream] Error en promesa de página ${index + 1}: ${err}`);
                        result = {
                                pageNumber: index + 1,
                                imagePath: null,
                                rasterTimeSeconds: null,
                                fallback: true,
                                rangeStart: index + 1,
                                rangeEnd: index + 1,
                                error: err
                        };
                }
                yield result;
        }

        await Promise.allSettled(tasks);
}

// Elimina imágenes temporales
function cleanupTempImages(outputDir) {
	if (fs.existsSync(outputDir)) {
		const files = fs.readdirSync(outputDir);
		files.forEach(file => {
			if (file.endsWith(".png")) {
				fs.unlinkSync(path.join(outputDir, file));
			}
		});
		// Opcional: eliminar el directorio si está vacío
		if (fs.readdirSync(outputDir).length === 0) {
			fs.rmdirSync(outputDir);
		}
	}
}

// Verifica que el PDF sea válido
function validatePdf(input) {
	try {
		if (Buffer.isBuffer(input)) {
			PDFDocument.load(input);
		} else if (typeof input === "string") {
			PDFDocument.load(fs.readFileSync(input));
		} else {
			throw new Error("Invalid PDF input");
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
