// Servicio para procesamiento de jobs OCR
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('../logger');
const pdfService = require('../pdfService');
const ocrService = require('../ocrService');
const parser = require('../parser');
const fieldExtractor = require('../fieldExtractor');
const isImageBlank = require('../utils/isImageBlank');
const { limit: concurrencyLimit } = require('../concurrency');
const { pdfProcessDuration, pageProcessDuration } = require('../config/metrics');
const bizagiService = require('./bizagiService');

// Procesar un PDF con OCR y enviar resultados a Bizagi
async function processOcrJob(pdfBase64, idioma, albaranesEsperados, caseId) {
	// Crear directorio temporal único para este job
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
	const tempPdfPath = path.join(tempDir, 'input.pdf');
	const outputDir = path.join(tempDir, 'images');
	
	let pageCount = 0;
	let pdfSizeMB = 0;

	try {
		// Escribir PDF a archivo temporal
		fs.writeFileSync(tempPdfPath, Buffer.from(pdfBase64, 'base64'));
		const pdfBuffer = fs.readFileSync(tempPdfPath);

		// Mapear idioma a código de Tesseract
		const tesseractLang = idioma === 'ESP' ? 'spa' : 'eng';

		// Validar PDF
		if (typeof pdfService.validatePdf === 'function') {
			if (!pdfService.validatePdf(pdfBuffer)) {
				throw new Error('El archivo proporcionado no es un PDF válido');
			}
		}

		// Cargar PDF y obtener número de páginas
		const pdfDoc = await pdfService.loadPdf(pdfBuffer);
		pageCount = pdfService.getPageCount(pdfDoc);
		pdfSizeMB = Number((pdfBuffer.length / (1024 * 1024)).toFixed(2));

		if (pageCount > 60) {
			throw new Error(`PDF tiene ${pageCount} páginas, excede el límite de 60.`);
		}

		// Extraer páginas a imágenes
		const startTotal = process.hrtime();
		const allImagePaths = await extractPagesToImages(tempPdfPath, outputDir, pageCount);

		// Filtrar páginas blancas y aplicar quick OCR
		const { imagenesValidas, paginasBlancas, quickOcrCache } = await filterBlankPages(
			allImagePaths,
			tesseractLang
		);

		// Procesar imágenes válidas con OCR
		const ocrResults = await processImagesWithOcr(
			imagenesValidas,
			paginasBlancas,
			pageCount,
			tesseractLang,
			quickOcrCache
		);

		// Calcular tiempo total transcurrido
		const elapsedTotal = process.hrtime(startTotal);
		const elapsedSeconds = elapsedTotal[0] + elapsedTotal[1] / 1e9;
		pdfProcessDuration.observe(elapsedSeconds);

		// Parsear y extraer campos
		const extracted = extractFields(ocrResults, idioma);

		logger.info(
			`[OCR] PDF procesado correctamente: ${pageCount} páginas, ${pdfSizeMB} MB, ` +
			`tiempo total: ${elapsedSeconds.toFixed(2)}s, páginas relevantes: ${extracted.length}`
		);

		// Construir payload del callback
		const callbackData = buildCallbackPayload(extracted, pageCount, paginasBlancas, albaranesEsperados);

		// Enviar callback a Bizagi
		await bizagiService.sendCallback(caseId, callbackData);

	} catch (error) {
		logger.error(`[OCR] Error procesando PDF (job caseId=${caseId}):`, error);
		
		// Enviar callback de error a Bizagi
		const errorPayload = {
			paginasInput: pageCount,
			albaranesExtraidos: 0,
			datos: [],
			paginasBlancas: [],
			statusError: true,
			mensaje: `Error procesando PDF: ${error.message}`
		};
		await bizagiService.sendCallback(caseId, errorPayload);
	} finally {
		// Limpiar archivos temporales
		await cleanupTempFiles(tempPdfPath, outputDir, tempDir);
	}
}

// Extraer páginas del PDF a imágenes
async function extractPagesToImages(tempPdfPath, outputDir, pageCount) {
	const allImagePaths = [];
	
	// Usar generador streaming si está disponible
	if (typeof pdfService.extractPagesAsImagesStream === 'function') {
		let pageIndex = 0;
		for await (const imagePath of pdfService.extractPagesAsImagesStream(tempPdfPath, outputDir, pageCount)) {
			allImagePaths.push({ imagePath, pageNumber: pageIndex + 1 });
			pageIndex++;
		}
	} else {
		const imagePaths = await pdfService.extractPagesAsImages(tempPdfPath, outputDir, pageCount);
		for (let i = 0; i < imagePaths.length; i++) {
			allImagePaths.push({ imagePath: imagePaths[i], pageNumber: i + 1 });
		}
	}
	
	return allImagePaths;
}

// Filtrar páginas en blanco y aplicar OCR rápido para retener páginas válidas
async function filterBlankPages(allImagePaths, tesseractLang) {
	const paginasBlancas = [];
	const imagenesValidas = [];
	const quickOcrCache = {};
	const MIN_CHARS_FOR_KEEP = 30;

	for (const { imagePath, pageNumber } of allImagePaths) {
		if (!imagePath) {
			paginasBlancas.push(pageNumber);
			continue;
		}

		let esBlanca = false;
		try {
			esBlanca = await isImageBlank(imagePath);
		} catch (err) {
			logger.warn(`[BLANK DETECTION] Error analizando página ${pageNumber}: ${err.message}`);
		}

		if (esBlanca) {
			let keptByQuickOcr = false;
			
			try {
				// Detectar orientación con OSD
				const angle = await ocrService.detectOrientationWithOSD(imagePath);
				let rotatedPath = imagePath;
				let createdRotated = false;

				// Rotar imagen si es necesario
				if (angle !== null && angle !== 0) {
					try {
						rotatedPath = await ocrService.rotateImage(imagePath, angle);
						createdRotated = true;
					} catch (rotateErr) {
						logger.warn(`[BLANK->QUICK OCR] No se pudo rotar página ${pageNumber}: ${rotateErr.message}`);
						rotatedPath = imagePath;
					}
				}

				// Aplicar OCR rápido para verificar si tiene suficiente contenido
				try {
					const quick = await ocrService.applyOcrToImage(rotatedPath, tesseractLang, false);
					const text = (quick && quick.text) ? quick.text : '';
					const cleaned = text.replace(/\s+/g, '');

					// Si tiene suficientes caracteres, conservar la página
					if (cleaned.length >= MIN_CHARS_FOR_KEEP) {
						keptByQuickOcr = true;
						quickOcrCache[pageNumber] = {
							text: quick.text,
							confidence: quick.confidence || 0,
							angle: angle || 0,
							osd: true
						};
						imagenesValidas.push({ imagePath, pageNumber });
						logger.info(
							`[BLANK->OCR] Página ${pageNumber} conservada por quick-OCR ` +
							`(${cleaned.length} chars). Resultado cacheado.`
						);
					}
				} catch (quickErr) {
					logger.warn(`[BLANK->QUICK OCR] Error OCR rápido página ${pageNumber}: ${quickErr.message}`);
				}

				// Limpiar imagen rotada temporal
				try {
					if (createdRotated && rotatedPath && fs.existsSync(rotatedPath)) {
						fs.unlinkSync(rotatedPath);
					}
				} catch (e) { /* ignore */ }

			} catch (err) {
				logger.warn(`[BLANK->QUICK OCR] Error en excepción quick-OCR para página ${pageNumber}: ${err.message}`);
			}

			// Si no se conservó por quick-OCR, marcar como blanca
			if (!keptByQuickOcr) {
				paginasBlancas.push(pageNumber);
				logger.info(`[BLANK] Página ${pageNumber} descartada por ser casi en blanco.`);
				try {
					if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
				} catch (e) { /* ignore */ }
			}
		} else {
			imagenesValidas.push({ imagePath, pageNumber });
		}
	}

	logger.info(`[QUICK-OCR CACHE] ${Object.keys(quickOcrCache).length} páginas con resultado cacheado para reutilización.`);

	return { imagenesValidas, paginasBlancas, quickOcrCache };
}

// Procesar imágenes válidas con OCR
async function processImagesWithOcr(imagenesValidas, paginasBlancas, pageCount, tesseractLang, quickOcrCache) {
	const ocrResults = new Array(pageCount);
	const tasks = [];

	for (const { imagePath, pageNumber } of imagenesValidas) {
		const i = pageNumber - 1;
		const task = concurrencyLimit(async () => {
			const startPage = process.hrtime();
			const cachedQuickOcr = quickOcrCache[pageNumber] || null;
			const ocrResult = await ocrService.processPageWithOcr(imagePath, tesseractLang, cachedQuickOcr);
			
			const pageElapsed = process.hrtime(startPage);
			const pageSeconds = pageElapsed[0] + pageElapsed[1] / 1e9;
			pageProcessDuration.observe(pageSeconds);

			if (ocrResult) {
				ocrResults[i] = {
					pageNumber,
					text: ocrResult.text,
					confidence: ocrResult.confidence,
					angle: ocrResult.angle,
					osd: ocrResult.osd || false,
					timeSeconds: pageSeconds
				};
			} else {
				ocrResults[i] = null;
			}

			try {
				if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
			} catch (e) { /* ignore */ }
		});
		tasks.push(task);
	}

	// Marcar páginas blancas como null
	for (const pageNumber of paginasBlancas) {
		ocrResults[pageNumber - 1] = null;
	}

	await Promise.all(tasks);
	return ocrResults;
}

// Extraer campos de los resultados OCR
function extractFields(ocrResults, idioma) {
	const pagesForParser = ocrResults
		.map((r) => r ? { text: r.text, pageNumber: r.pageNumber } : null)
		.filter(Boolean);

	const relevantPages = (typeof parser.parseDocument === 'function')
		? parser.parseDocument(pagesForParser)
		: pagesForParser;

	return relevantPages.map(page => {
		if (typeof fieldExtractor.extractFieldsFromText === 'function') {
			let timeSeconds = null;
			const ocrResult = ocrResults[page.pageNumber - 1];
			if (ocrResult && typeof ocrResult.timeSeconds === 'number') {
				timeSeconds = ocrResult.timeSeconds;
			}
			const campos = fieldExtractor.extractFieldsFromText(page.text, page.pageNumber, idioma);
			return { ...campos, timeSeconds };
		}
		return { pageNumber: page.pageNumber, rawText: page.text };
	});
}

// Construir payload para el callback a Bizagi
function buildCallbackPayload(extracted, pageCount, paginasBlancas, albaranesEsperados) {
	const numExtraidos = extracted.length;
	const numParciales = extracted.filter(x => x.statusError).length;
	let statusErrorGlobal = false;
	const mensajeGlobal = [];

	if (typeof albaranesEsperados === 'number' && numExtraidos < albaranesEsperados) {
		statusErrorGlobal = true;
		mensajeGlobal.push(`Solo se reconocieron ${numExtraidos} de ${albaranesEsperados} albaranes.`);
	}

	if (numParciales > 0) {
		statusErrorGlobal = true;
		mensajeGlobal.push(`${numParciales} albaranes parcialmente extraídos.`);
	}

	return {
		paginasInput: pageCount,
		albaranesExtraidos: numExtraidos,
		datos: extracted,
		paginasBlancas,
		statusError: statusErrorGlobal,
		mensaje: mensajeGlobal.join(' | ')
	};
}

// Limpiar archivos y directorios temporales
async function cleanupTempFiles(tempPdfPath, outputDir, tempDir) {
	try {
		if (typeof pdfService.cleanupTempImages === 'function') {
			await pdfService.cleanupTempImages(outputDir);
		} else if (fs.existsSync(outputDir)) {
			const files = fs.readdirSync(outputDir || '');
			for (const file of files) {
				try {
					fs.unlinkSync(path.join(outputDir, file));
				} catch (e) { /* ignore */ }
			}
			try {
				fs.rmdirSync(outputDir);
			} catch (e) { /* ignore */ }
		}
	} catch (cleanupErr) {
		logger.error('[CLEANUP] Error al limpiar imágenes temporales:', cleanupErr);
	}

	try {
		if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
	} catch (cleanupErr) {
		logger.error('[CLEANUP] Error al eliminar PDF temporal:', cleanupErr);
	}

	try {
		if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
	} catch (e) { /* ignore */ }
}

module.exports = {
	processOcrJob,
};
