// server.js
require('dotenv').config();

const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const pdfService = require('./pdfService');
const ocrService = require('./ocrService');
const pLimit = require('p-limit'); // usar como función: pLimit(concurrency)
const helmet = require('helmet');
const cors = require('cors');
const logger = require('./logger');
const promClient = require('prom-client');
const rateLimit = require('express-rate-limit');
const os = require('os');

// Importar módulos de polling
const jobManager = require('./jobManager');
const worker = require('./worker');

// ---------- Configuración de rate limiting ----------
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
	: 600000;
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
		logger.error('[METRICS] Error al obtener métricas:', {
			message: err.message,
			stack: err.stack?.split('\n')[0]
		});
		res.status(500).end(err.message || 'Error getting metrics');
	}
});

// ---------- Configuración OCR/concurrency ----------
const DEFAULT_CONCURRENCY = process.env.OCR_CONCURRENCY
	? parseInt(process.env.OCR_CONCURRENCY, 10)
	: 5;

// ---------- Endpoints de polling OCR ----------

// Endpoint para iniciar procesamiento OCR asíncrono
app.post('/api/start-process', async (req, res) => {
	try {
		const { pdfBase64, idioma, albaranesEsperados } = req.body;

		// Validar entrada
		if (!pdfBase64 || typeof pdfBase64 !== 'string') {
			return res.status(400).json({ 
				error: 'pdfBase64 es requerido y debe ser una cadena no vacía' 
			});
		}

		// Validar idioma
		const idiomaInput = (typeof idioma === 'string') ? idioma.trim().toUpperCase() : '';
		if (!['ESP', 'ING'].includes(idiomaInput)) {
			return res.status(400).json({ 
				error: 'El campo "idioma" es obligatorio y debe ser "ESP" o "ING"' 
			});
		}

		// Validar albaranesEsperados si viene
		let albaranesEsperadosValue = undefined;
		if (typeof albaranesEsperados !== 'undefined') {
			const n = Number(albaranesEsperados);
			if (!Number.isInteger(n) || n < 0) {
				return res.status(400).json({ 
					error: 'El campo "albaranesEsperados" debe ser un número entero positivo si se proporciona' 
				});
			}
			albaranesEsperadosValue = n;
		}

		// Validar formato base64
		try {
			Buffer.from(pdfBase64, 'base64');
		} catch (err) {
			return res.status(400).json({ 
				error: 'Formato base64 inválido' 
			});
		}

		// Crear trabajo y devolver jobId
		const options = {
			idioma: idiomaInput,
			albaranesEsperados: albaranesEsperadosValue
		};

		const jobId = jobManager.createJob(pdfBase64, options);

		logger.info(`[API] Trabajo OCR iniciado: ${jobId}`, {
			idioma: idiomaInput,
			albaranesEsperados: albaranesEsperadosValue,
			pdfSize: `${(pdfBase64.length * 0.75 / 1024 / 1024).toFixed(2)} MB`
		});

		res.json({ jobId });

	} catch (error) {
		logger.error('[API] Error iniciando trabajo OCR:', {
			message: error.message,
			stack: error.stack?.split('\n')[0]
		});
		res.status(500).json({ 
			error: 'Error interno del servidor al iniciar el procesamiento' 
		});
	}
});

// Endpoint para consultar estado del trabajo
app.get('/api/job-status/:jobId', async (req, res) => {
	try {
		const { jobId } = req.params;

		if (!jobId) {
			return res.status(400).json({ 
				error: 'jobId es requerido' 
			});
		}

		const status = jobManager.getJobStatus(jobId);

		if (status === null) {
			return res.status(404).json({ 
				error: 'Trabajo no encontrado' 
			});
		}

		res.json({ 
			jobId,
			status 
		});

	} catch (error) {
		logger.error('[API] Error consultando estado del trabajo:', {
			message: error.message,
			stack: error.stack?.split('\n')[0]
		});
		res.status(500).json({ 
			error: 'Error interno del servidor al consultar el estado' 
		});
	}
});

// Endpoint para obtener resultado del trabajo
app.get('/api/job-result/:jobId', async (req, res) => {
	try {
		const { jobId } = req.params;

		if (!jobId) {
			return res.status(400).json({
				paginasInput: 0,
				albaranesExtraidos: 0,
				datos: [],
				statusError: true,
				mensaje: 'jobId es requerido'
			});
		}

		const result = jobManager.getJobResult(jobId);

		if (result === null) {
			return res.status(404).json({
				paginasInput: 0,
				albaranesExtraidos: 0,
				datos: [],
				statusError: true,
				mensaje: 'Trabajo no encontrado'
			});
		}

		res.json(result);

	} catch (error) {
		logger.error('[API] Error obteniendo resultado del trabajo:', {
			message: error.message,
			stack: error.stack?.split('\n')[0]
		});
		res.status(500).json({
			paginasInput: 0,
			albaranesExtraidos: 0,
			datos: [],
			statusError: true,
			mensaje: 'Error interno del servidor al obtener el resultado'
		});
	}
});

// Endpoint para estadísticas del sistema de trabajos (opcional, para debugging)
app.get('/api/job-stats', async (req, res) => {
	try {
		const jobStats = jobManager.getStats();
		const workerStats = worker.getStats();

		res.json({
			jobs: jobStats,
			worker: workerStats
		});

	} catch (error) {
		logger.error('[API] Error obteniendo estadísticas:', {
			message: error.message,
			stack: error.stack?.split('\n')[0]
		});
		res.status(500).json({ 
			error: 'Error interno del servidor al obtener estadísticas' 
		});
	}
});

// ---------- Endpoint de procesamiento de PDF (original) ----------
app.post('/api/process-pdf', async (req, res) => {
	const { pdfBase64, idioma, albaranesEsperados } = req.body;
	// Validar idioma
	const idiomaInput = (typeof idioma === 'string') ? idioma.trim().toUpperCase() : '';
	if (!['ESP', 'ING'].includes(idiomaInput)) {
		return res.status(400).json({ error: 'El campo "idioma" es obligatorio y debe ser "ESP" o "ING".' });
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

	const tempPdfPath = path.join(os.tmpdir(), 'temp.pdf');
	const outputDir = path.join(os.tmpdir(), 'temp_images');
	let imagePaths = [];
	let pageCount = 0;
	let pdfSizeMB = 0;

	try {
		const pdfBuffer = Buffer.from(pdfBase64, 'base64');

		// Validación del PDF (pdfService debe exponer validatePdf)
		if (typeof pdfService.validatePdf === 'function') {
			if (!pdfService.validatePdf(pdfBuffer)) {
				return res.status(400).json({ error: 'El archivo proporcionado no es un PDF válido' });
			}
		}

		// Guardar temporalmente
		fs.writeFileSync(tempPdfPath, pdfBuffer);

		// Cargar PDF y obtener páginas
		const pdfDoc = await pdfService.loadPdf(pdfBuffer);
		pageCount = pdfService.getPageCount(pdfDoc);
		pdfSizeMB = Number((pdfBuffer.length / (1024 * 1024)).toFixed(2));

		if (pageCount > 60) {
			logger.error(`PDF tiene ${pageCount} páginas, excede el límite de 60.`);
			throw new Error(`PDF tiene ${pageCount} páginas, excede el límite de 60.`);
		}

		// Extraer páginas a imágenes (pdfService.extractPagesAsImages debe crear outputDir)
		imagePaths = await pdfService.extractPagesAsImages(tempPdfPath, outputDir, pageCount);

		const startTotal = process.hrtime();
		const limit = pLimit(DEFAULT_CONCURRENCY);
		const ocrResults = new Array(imagePaths.length);
		const tasks = imagePaths.map((imagePath, i) =>
			limit(async () => {
				const startPage = process.hrtime();
				// Pasar idioma a OCR
				const ocrResult = await ocrService.processPageWithOcr(imagePath, tesseractLang);
				const pageElapsed = process.hrtime(startPage);
				const pageSeconds = pageElapsed[0] + pageElapsed[1] / 1e9;
				pageProcessDuration.observe(pageSeconds);
				if (ocrResult) {
					ocrResults[i] = {
						pageNumber: i + 1,
						text: ocrResult.text,
						confidence: ocrResult.confidence,
						angle: ocrResult.angle,
						osd: ocrResult.osd || false,
						timeSeconds: pageSeconds
					};
				} else {
					ocrResults[i] = null;
				}
			})
		);

		await Promise.all(tasks);

		const elapsedTotal = process.hrtime(startTotal);
		const elapsedSeconds = elapsedTotal[0] + elapsedTotal[1] / 1e9;
		pdfProcessDuration.observe(elapsedSeconds);

		// 1. Filtrar páginas relevantes usando parser.parseDocument
		const pagesForParser = ocrResults
			.map((r) => r ? { text: r.text, pageNumber: r.pageNumber } : null)
			.filter(Boolean);

		const relevantPages = (typeof parser.parseDocument === 'function')
			? parser.parseDocument(pagesForParser)
			: pagesForParser; // si no existe parser, devolver todo

		// 2. Extraer campos estructurados usando fieldExtractor
		const extracted = relevantPages.map(page => {
			if (typeof fieldExtractor.extractFieldsFromText === 'function') {
				// Pasar idioma a extracción de campos
				return fieldExtractor.extractFieldsFromText(page.text, page.pageNumber, idiomaInput);
			}
			return { pageNumber: page.pageNumber, rawText: page.text };
		});

		logger.info(`[OCR] PDF procesado correctamente: ${pageCount} páginas, ${pdfSizeMB} MB, tiempo total: ${elapsedSeconds.toFixed(2)}s, páginas relevantes: ${extracted.length}`);
		// Nuevo response con trazabilidad y estado global
		const numEsperados = albaranesEsperadosValue;
		const numExtraidos = extracted.length;
		const numParciales = extracted.filter(x => x.statusError).length;

		let statusErrorGlobal = false;
		let mensajeGlobal = [];

		if (typeof numEsperados === 'number' && numExtraidos < numEsperados) {
			statusErrorGlobal = true;
			mensajeGlobal.push(`Solo se reconocieron ${numExtraidos} de ${numEsperados} albaranes.`);
		}
		if (numParciales > 0) {
			statusErrorGlobal = true;
			mensajeGlobal.push(`${numParciales} albaranes parcialmente extraídos.`);
		}

		const response = {
			paginasInput: pageCount,
			albaranesExtraidos: numExtraidos,
			datos: extracted,
			statusError: statusErrorGlobal,
			mensaje: mensajeGlobal.join(' | ')
		};
		return res.json(response);
	} catch (err) {
		logger.error('[OCR] Error procesando PDF:', {
			message: err.message,
			stack: err.stack?.split('\n')[0]
		});
		if (err.message && err.message.includes('excede el límite de 60')) {
			return res.status(400).json({ error: err.message });
		}
		return res.status(500).json({ error: err.message || 'Error processing PDF' });
	} finally {
		// Limpieza de recursos temporales
		try {
			if (Array.isArray(imagePaths) && imagePaths.length > 0 && typeof pdfService.cleanupTempImages === 'function') {
				await pdfService.cleanupTempImages(outputDir);
			} else if (fs.existsSync(outputDir)) {
				// fallback: intentar eliminar archivos dentro de outputDir
				fs.readdir(outputDir, (err, files) => {
					if (!err && Array.isArray(files)) {
						for (const file of files) {
							try { fs.unlinkSync(path.join(outputDir, file)); } catch (e) { /* ignore */ }
						}
						try { fs.rmdirSync(outputDir); } catch (e) { /* ignore */ }
					}
				});
			}
		} catch (cleanupErr) {
			logger.error('[CLEANUP] Error al limpiar imágenes temporales:', {
				message: cleanupErr.message,
				stack: cleanupErr.stack?.split('\n')[0]
			});
		}
		try {
			if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
		} catch (cleanupErr) {
			logger.error('[CLEANUP] Error al eliminar PDF temporal:', {
				message: cleanupErr.message,
				stack: cleanupErr.stack?.split('\n')[0]
			});
		}
	}
});

// ---------- Endpoint de salud ----------
app.get('/health', async (req, res) => {
	// Verificar Tesseract
	const tesseractOk = await new Promise(resolve => {
		const { spawn } = require('child_process');
		const proc = spawn('tesseract', ['--version']);
		proc.on('error', () => resolve(false));
		proc.on('close', code => resolve(code === 0));
	});

	// Verificar Poppler (pdftocairo)
	const popplerOk = await new Promise(resolve => {
		const { spawn } = require('child_process');
		// -v no siempre devuelve 0 en pdftocairo; simplemente comprobar existencia ejecutable
		const proc = spawn('pdftocairo', ['-v']);
		proc.on('error', () => resolve(false));
		proc.on('close', code => {
			// pdftocairo suele enviar salida por stderr y cerrar con 0; considerar 0 como OK
			resolve(code === 0);
		});
	});

	// Verificar memoria libre (indicador simple)
	let diskOk = false;
	try {
		const freeMB = os.freemem() / (1024 * 1024);
		diskOk = freeMB > 100; // >100MB
	} catch (e) {
		diskOk = false;
	}

	res.json({
		tesseract: tesseractOk,
		poppler: popplerOk,
		diskSpaceOK: diskOk
	});
});

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	logger.info(`Server running on port ${PORT}`);
	
	// Iniciar worker OCR para procesamiento en segundo plano
	worker.start();
	logger.info('[Worker] Worker OCR iniciado para procesamiento asíncrono');

	// Limpiar trabajos antiguos cada hora
	setInterval(() => {
		jobManager.cleanOldJobs(24); // Limpiar trabajos mayores a 24 horas
	}, 60 * 60 * 1000); // Cada hora
});

// Manejar cierre graceful del servidor
process.on('SIGTERM', () => {
	logger.info('[Server] Recibida señal SIGTERM, cerrando servidor...');
	worker.stop();
	process.exit(0);
});

process.on('SIGINT', () => {
	logger.info('[Server] Recibida señal SIGINT, cerrando servidor...');
	worker.stop();
	process.exit(0);
});
