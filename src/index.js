// server.js
require('dotenv').config();

const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const pdfService = require('./pdfService');
const ocrService = require('./ocrService');
const { limit: concurrencyLimit } = require('./concurrency');
const isImageBlank = require('./utils/isImageBlank');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('./logger');
const promClient = require('prom-client');
const rateLimit = require('express-rate-limit');
const os = require('os');
const axios = require('axios');

// ---------- Configuración de rate limiting ----------
// --- Arreglo para evitar "undefined request.ip" ---
app.set('trust proxy', false);

const RATE_LIMIT_WINDOW_MS = process.env.RATE_LIMIT_WINDOW_MS
	? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10)
	: 15 * 60 * 1000; // 15 min
const RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX
	? parseInt(process.env.RATE_LIMIT_MAX, 10)
	: 100; // 100 requests por ventana

const limiter = rateLimit({
	windowMs: RATE_LIMIT_WINDOW_MS,
	max: RATE_LIMIT_MAX,
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		error: 'Demasiadas peticiones desde esta IP. Intenta de nuevo más tarde.'
	},
	keyGenerator: (req) => {
		// Usa cabecera o socket, y evita errores cuando no hay IP disponible
		return req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
	}
});

// ---------- Prometheus metrics ----------
const pdfProcessDuration = new promClient.Histogram({
	name: 'pdf_process_duration_seconds',
	help: 'Duración total del procesamiento de PDF (segundos)',
	buckets: [1, 5, 10, 20, 30, 60, 120, 300, 600]
});
const pageProcessDuration = new promClient.Histogram({
	name: 'page_process_duration_seconds',
	help: 'Duración del procesamiento de página (segundos)',
	buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 30, 60]
});
const httpRequestCounter = new promClient.Counter({
	name: 'http_requests_total',
	help: 'Total de requests HTTP',
	labelNames: ['method', 'route', 'status']
});
const httpRequestDuration = new promClient.Histogram({
	name: 'http_request_duration_seconds',
	help: 'Duración de requests HTTP en segundos',
	labelNames: ['method', 'route', 'status']
});

// Registrar métricas por defecto
promClient.collectDefaultMetrics();

// ---------- Middlewares de seguridad, CORS, rate limit y body parsing ----------
app.use(helmet());
app.use(limiter);

const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
	? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
	: ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
	origin: function (origin, callback) {
		// Permitir peticiones sin origin (curl, Postman, etc.)
		if (!origin) return callback(null, true);
		if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
		return callback(new Error('CORS: Origin not allowed: ' + origin));
	}
}));

// bodyParser (json grande permitido)
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Timeout global para peticiones HTTP (default: 10 minutos)
const HTTP_TIMEOUT_MS = process.env.HTTP_TIMEOUT_MS
	? parseInt(process.env.HTTP_TIMEOUT_MS, 10)
	: 1600000;
app.use((req, res, next) => {
	res.setTimeout(HTTP_TIMEOUT_MS, () => {
		logger.error(`[HTTP] Timeout alcanzado (${HTTP_TIMEOUT_MS} ms) para ${req.method} ${req.originalUrl}`);
		if (!res.headersSent) {
			res.status(503).json({ error: `Timeout: la operación excedió ${Math.round(HTTP_TIMEOUT_MS / 60000)} minutos.` });
		}
	});
	next();
});

// Middleware para contar y medir requests
app.use((req, res, next) => {
	const start = process.hrtime();
	res.on('finish', () => {
		const route = (req.route && req.route.path) ? req.route.path : req.path;
		const status = String(res.statusCode);
		httpRequestCounter.inc({ method: req.method, route, status });
		const diff = process.hrtime(start);
		const duration = diff[0] + diff[1] / 1e9;
		httpRequestDuration.observe({ method: req.method, route, status }, duration);
	});
	next();
});

// Endpoint /metrics para Prometheus
app.get('/metrics', async (req, res) => {
	try {
		res.set('Content-Type', promClient.register.contentType);
		res.end(await promClient.register.metrics());
	} catch (err) {
		logger.error('[METRICS] Error al obtener métricas:', err);
		res.status(500).end(err.message || 'Error getting metrics');
	}
});

// ---------- Configuración OCR/concurrency ----------
const DEFAULT_CONCURRENCY = process.env.OCR_CONCURRENCY
	? parseInt(process.env.OCR_CONCURRENCY, 10)
	: 5;

// Bizagi config desde .env
const BIZAGI_BASE_URL = process.env.BIZAGI_BASE_URL || '';
const BIZAGI_TOKEN = process.env.BIZAGI_TOKEN || '';

// Estado interno simple para marcar callbacks fallidos (en memoria)
const jobCallbackState = new Map();

// ---------- Endpoint de procesamiento de PDF ----------
app.post('/api/process-pdf', async (req, res) => {
	const { pdfBase64, idioma, albaranesEsperados, caseId } = req.body;
	// Validar idioma
	const idiomaInput = (typeof idioma === 'string') ? idioma.trim().toUpperCase() : '';
	if (!['ESP', 'ING'].includes(idiomaInput)) {
		return res.status(400).json({ error: 'El campo "idioma" es obligatorio y debe ser "ESP" o "ING".' });
	}
	// Validar caseId (nuevo)
	if (typeof caseId === 'undefined' || !Number.isInteger(Number(caseId))) {
		return res.status(400).json({ error: 'El campo "caseId" es obligatorio y debe ser un entero.' });
	}
	// Mapear idioma a código de Tesseract
	const tesseractLang = idiomaInput === 'ESP' ? 'spa' : 'eng';

	// Validar albaranesEsperados si viene (opcional, debe ser número entero positivo)
	let albaranesEsperadosValue = undefined;
	if (typeof albaranesEsperados !== 'undefined') {
		const n = Number(albaranesEsperados);
		if (!Number.isInteger(n) || n < 0) {
			return res.status(400).json({ error: 'El campo "albaranesEsperados" debe ser un número entero positivo si se proporciona.' });
		}
		albaranesEsperadosValue = n;
	}
	const parser = require('./parser');
	const fieldExtractor = require('./fieldExtractor');

	// Validación base64
	if (!pdfBase64 || typeof pdfBase64 !== 'string') {
		return res.status(400).json({ error: 'pdfBase64 must be a non-empty string' });
	}
	try {
		// comprobar si es base64 decodificable
		Buffer.from(pdfBase64, 'base64');
	} catch (err) {
		return res.status(400).json({ error: 'Invalid base64 format' });
	}

	// Guardar PDF temporalmente en un directorio único para evitar colisiones
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
	const tempPdfPath = path.join(tempDir, 'input.pdf');
	const outputDir = path.join(tempDir, 'images');
	fs.writeFileSync(tempPdfPath, Buffer.from(pdfBase64, 'base64'));

	// Encolar job asincrónico (fire-and-forget). Devolver 200 OK inmediatamente.
	(async function processPdfJob() {
			let imagePaths = [];
			let pageCount = 0;
			let pdfSizeMB = 0;
			let callbackFailedFlag = false;
			try {
				const pdfBuffer = fs.readFileSync(tempPdfPath);
				// Validación del PDF
				if (typeof pdfService.validatePdf === 'function') {
					if (!pdfService.validatePdf(pdfBuffer)) {
						throw new Error('El archivo proporcionado no es un PDF válido');
					}
				}
				// Cargar PDF y obtener páginas
				const pdfDoc = await pdfService.loadPdf(pdfBuffer);
				pageCount = pdfService.getPageCount(pdfDoc);
				pdfSizeMB = Number((pdfBuffer.length / (1024 * 1024)).toFixed(2));
				if (pageCount > 60) throw new Error(`PDF tiene ${pageCount} páginas, excede el límite de 60.`);

				// Extraer páginas a imágenes
				const startTotal = process.hrtime();
				const limit = concurrencyLimit;
				let allImagePaths = [];
				if (typeof pdfService.extractPagesAsImagesStream === 'function') {
					let pageIndex = 0;
					for await (const imagePath of pdfService.extractPagesAsImagesStream(tempPdfPath, outputDir, pageCount)) {
						allImagePaths.push({ imagePath, pageNumber: pageIndex + 1 });
						pageIndex++;
					}
				} else {
					imagePaths = await pdfService.extractPagesAsImages(tempPdfPath, outputDir, pageCount);
					for (let i = 0; i < imagePaths.length; i++) {
						allImagePaths.push({ imagePath: imagePaths[i], pageNumber: i + 1 });
					}
				}

				// Filtrar páginas casi blancas y quick-OCR
				const paginasBlancas = [];
				const imagenesValidas = [];
				const quickOcrCache = {};
				for (const { imagePath, pageNumber } of allImagePaths) {
					if (!imagePath) { paginasBlancas.push(pageNumber); continue; }
					let esBlanca = false;
					try { esBlanca = await isImageBlank(imagePath); } catch (err) { logger.warn(`[BLANK DETECTION] Error analizando página ${pageNumber}: ${err.message}`); }
					if (esBlanca) {
						let keptByQuickOcr = false;
						try {
							const angle = await ocrService.detectOrientationWithOSD(imagePath);
							let rotatedPath = imagePath;
							let createdRotated = false;
							if (angle !== null && angle !== 0) {
								try { rotatedPath = await ocrService.rotateImage(imagePath, angle); createdRotated = true; } catch (rotateErr) { logger.warn(`[BLANK->QUICK OCR] No se pudo rotar página ${pageNumber}: ${rotateErr.message}`); rotatedPath = imagePath; }
							}
							try {
								const quick = await ocrService.applyOcrToImage(rotatedPath, tesseractLang, false);
								const text = (quick && quick.text) ? quick.text : '';
								const cleaned = text.replace(/\s+/g, '');
								const MIN_CHARS_FOR_KEEP = 30;
								if (cleaned.length >= MIN_CHARS_FOR_KEEP) {
									keptByQuickOcr = true;
									quickOcrCache[pageNumber] = { text: quick.text, confidence: quick.confidence || 0, angle: angle || 0, osd: true };
									imagenesValidas.push({ imagePath, pageNumber });
									logger.info(`[BLANK->OCR] Página ${pageNumber} conservada por quick-OCR (${cleaned.length} chars). Resultado cacheado.`);
								}
							} catch (quickErr) { logger.warn(`[BLANK->QUICK OCR] Error OCR rápido página ${pageNumber}: ${quickErr.message}`); }
							try { if (createdRotated && rotatedPath && fs.existsSync(rotatedPath)) fs.unlinkSync(rotatedPath); } catch (e) { }
						} catch (err) { logger.warn(`[BLANK->QUICK OCR] Error en excepción quick-OCR para página ${pageNumber}: ${err.message}`); }

						if (!keptByQuickOcr) {
							paginasBlancas.push(pageNumber);
							logger.info(`[BLANK] Página ${pageNumber} descartada por ser casi en blanco.`);
							try { if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath); } catch (e) { }
						}
					} else {
						imagenesValidas.push({ imagePath, pageNumber });
					}
				}
				logger.info(`[QUICK-OCR CACHE] ${Object.keys(quickOcrCache).length} páginas con resultado cacheado para reutilización.`);

				// Procesar imágenes válidas con OCR
				const ocrResults = new Array(pageCount);
				const tasks = [];
				for (const { imagePath, pageNumber } of imagenesValidas) {
					const i = pageNumber - 1;
					const task = limit(async () => {
						const startPage = process.hrtime();
						const cachedQuickOcr = quickOcrCache[pageNumber] || null;
						const ocrResult = await ocrService.processPageWithOcr(imagePath, tesseractLang, cachedQuickOcr);
						const pageElapsed = process.hrtime(startPage);
						const pageSeconds = pageElapsed[0] + pageElapsed[1] / 1e9;
						pageProcessDuration.observe(pageSeconds);
						if (ocrResult) {
							ocrResults[i] = { pageNumber, text: ocrResult.text, confidence: ocrResult.confidence, angle: ocrResult.angle, osd: ocrResult.osd || false, timeSeconds: pageSeconds };
						} else {
							ocrResults[i] = null;
						}
						try { if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath); } catch (e) { }
					});
					tasks.push(task);
				}
				for (const pageNumber of paginasBlancas) ocrResults[pageNumber - 1] = null;
				await Promise.all(tasks);

				const elapsedTotal = process.hrtime(startTotal);
				const elapsedSeconds = elapsedTotal[0] + elapsedTotal[1] / 1e9;
				pdfProcessDuration.observe(elapsedSeconds);

				const pagesForParser = ocrResults.map((r) => r ? { text: r.text, pageNumber: r.pageNumber } : null).filter(Boolean);
				const relevantPages = (typeof parser.parseDocument === 'function') ? parser.parseDocument(pagesForParser) : pagesForParser;
				const extracted = relevantPages.map(page => {
					if (typeof fieldExtractor.extractFieldsFromText === 'function') {
						let timeSeconds = null;
						const ocrResult = ocrResults[page.pageNumber - 1];
						if (ocrResult && typeof ocrResult.timeSeconds === 'number') timeSeconds = ocrResult.timeSeconds;
						const campos = fieldExtractor.extractFieldsFromText(page.text, page.pageNumber, idiomaInput);
						return { ...campos, timeSeconds };
					}
					return { pageNumber: page.pageNumber, rawText: page.text };
				});

				logger.info(`[OCR] PDF procesado correctamente: ${pageCount} páginas, ${pdfSizeMB} MB, tiempo total: ${elapsedSeconds.toFixed(2)}s, páginas relevantes: ${extracted.length}`);

				const numEsperados = albaranesEsperadosValue;
				const numExtraidos = extracted.length;
				const numParciales = extracted.filter(x => x.statusError).length;
				let statusErrorGlobal = false;
				let mensajeGlobal = [];
				if (typeof numEsperados === 'number' && numExtraidos < numEsperados) { statusErrorGlobal = true; mensajeGlobal.push(`Solo se reconocieron ${numExtraidos} de ${numEsperados} albaranes.`); }
				if (numParciales > 0) { statusErrorGlobal = true; mensajeGlobal.push(`${numParciales} albaranes parcialmente extraídos.`); }

				const callbackBody = {
					paginasInput: pageCount,
					albaranesExtraidos: numExtraidos,
					datos: extracted,
					paginasBlancas,
					statusError: statusErrorGlobal,
					mensaje: mensajeGlobal.join(' | ')
				};

				// Enviar callback a Bizagi
				if (BIZAGI_BASE_URL && BIZAGI_TOKEN) {
					const url = `${BIZAGI_BASE_URL.replace(/\/$/, '')}/odata/data/cases/${caseId}/events/EvtOCRCompletado/next`;
					try {
						await axios.post(url, callbackBody, { headers: { Authorization: `Bearer ${BIZAGI_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 15000 });
						logger.info(`[CALLBACK] Callback Bizagi OK para caseId=${caseId}`);
						jobCallbackState.set(caseId, { callbackFailed: false });
					} catch (cbErr) {
						logger.error(`[CALLBACK] Error al notificar Bizagi para caseId=${caseId}: ${cbErr.message}`);
						jobCallbackState.set(caseId, { callbackFailed: true, error: cbErr.message });
						callbackFailedFlag = true;
					}
				} else {
					logger.warn('[CALLBACK] BIZAGI_BASE_URL o BIZAGI_TOKEN no configurados. Saltando callback.');
					jobCallbackState.set(caseId, { callbackFailed: true, error: 'missing-bizagi-config' });
					callbackFailedFlag = true;
				}

			} catch (err) {
				logger.error('[OCR] Error procesando PDF (job):', err);
			} finally {
				// Limpieza de recursos temporales
				try {
					if (typeof pdfService.cleanupTempImages === 'function') {
						await pdfService.cleanupTempImages(outputDir);
					} else if (fs.existsSync(outputDir)) {
						const files = fs.readdirSync(outputDir || '');
						for (const file of files) { try { fs.unlinkSync(path.join(outputDir, file)); } catch (e) { } }
						try { fs.rmdirSync(outputDir); } catch (e) { }
					}
				} catch (cleanupErr) { logger.error('[CLEANUP] Error al limpiar imágenes temporales:', cleanupErr); }
				try { if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath); } catch (cleanupErr) { logger.error('[CLEANUP] Error al eliminar PDF temporal:', cleanupErr); }
				try { if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir); } catch (e) { }
			}
	})();

	// Responder inmediatamente indicando que el job fue encolado
	return res.status(200).json({ status: 'queued', caseId: Number(caseId) });
});

// end of /api/process-pdf handler

// ---------- Log de concurrencia y DPI ----------
const OCR_CONCURRENCY = process.env.OCR_CONCURRENCY ? String(process.env.OCR_CONCURRENCY) : require('./concurrency').DEFAULT_CONCURRENCY;
const OCR_DPI = process.env.OCR_DPI ? String(process.env.OCR_DPI) : '300';
logger.info(`[CONFIG] OCR_CONCURRENCY: ${OCR_CONCURRENCY}`);
logger.info(`[CONFIG] OCR_DPI: ${OCR_DPI}`);

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
	logger.info(`Server running on port ${PORT}`);
});
