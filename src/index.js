// Métricas de performance
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
const rateLimit = require("express-rate-limit");

// Configuración de rate limiting
const RATE_LIMIT_WINDOW_MS = process.env.RATE_LIMIT_WINDOW_MS ? parseInt(process.env.RATE_LIMIT_WINDOW_MS) : 15 * 60 * 1000; // 15 min
const RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX) : 100; // 100 requests por ventana
const limiter = rateLimit({
	windowMs: RATE_LIMIT_WINDOW_MS,
	max: RATE_LIMIT_MAX,
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		error: `Demasiadas peticiones desde esta IP. Intenta de nuevo más tarde.`
	}
});
app.use(limiter);
const promClient = require("prom-client");

// Configuración de métricas Prometheus
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics();

// Métricas personalizadas
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

// Middleware para contar y medir requests
app.use((req, res, next) => {
	const start = process.hrtime();
	res.on('finish', () => {
		const route = req.route && req.route.path ? req.route.path : req.path;
		const status = res.statusCode;
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
		res.status(500).end(err.message);
	}
});
require('dotenv').config();

const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const pdfService = require("./pdfService");
const ocrService = require("./ocrService");
const pLimit = require("p-limit").default;
const helmet = require("helmet");
const cors = require("cors");

const logger = require("./logger");
const app = express();
app.use(helmet());

// CORS restrictivo por defecto (solo localhost), personalizable por variable de entorno
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : ["http://localhost:3000", "http://127.0.0.1:3000"];
app.use(cors({
	origin: function(origin, callback) {
		// Permitir peticiones sin origen (curl, Postman, etc.)
		if (!origin) return callback(null, true);
		if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
		return callback(new Error("CORS: Origin not allowed: " + origin));
	}
}));
app.use(bodyParser.json({ limit: "100mb" }));

// Timeout global para peticiones HTTP (default: 10 minutos)
const HTTP_TIMEOUT_MS = process.env.HTTP_TIMEOUT_MS ? parseInt(process.env.HTTP_TIMEOUT_MS) : 600000;
app.use((req, res, next) => {
	res.setTimeout(HTTP_TIMEOUT_MS, () => {
		logger.error(`[HTTP] Timeout alcanzado (${HTTP_TIMEOUT_MS} ms) para ${req.method} ${req.originalUrl}`);
		if (!res.headersSent) {
			res.status(503).json({ error: `Timeout: la operación excedió ${HTTP_TIMEOUT_MS / 1000 / 60} minutos.` });
		}
	});
	next();
});

// Valor de concurrencia configurable
const DEFAULT_CONCURRENCY = process.env.OCR_CONCURRENCY ? parseInt(process.env.OCR_CONCURRENCY) : 5;

app.post("/api/process-pdf", async (req, res) => {
	const { pdfBase64 } = req.body;
	// Validación robusta de base64
	if (!pdfBase64 || typeof pdfBase64 !== 'string') {
		return res.status(400).json({ error: "pdfBase64 must be a non-empty string" });
	}
	try {
		Buffer.from(pdfBase64, 'base64');
	} catch (err) {
		return res.status(400).json({ error: "Invalid base64 format" });
	}
	// Crear archivo temporal para el PDF
	const tempPdfPath = path.join(__dirname, "temp.pdf");
	const outputDir = path.join(__dirname, "temp_images");
	let imagePaths = [];
	let pageCount = 0;
	let pdfSizeMB = 0;
	try {
		// Decodificar base64
		const pdfBuffer = Buffer.from(pdfBase64, "base64");

		// Validar que el buffer sea un PDF válido
		if (!pdfService.validatePdf(pdfBuffer)) {
			return res.status(400).json({ error: "El archivo proporcionado no es un PDF válido" });
		}

		// Guardar como archivo temporal
		fs.writeFileSync(tempPdfPath, pdfBuffer);

		// Cargar PDF y obtener número de páginas
		const pdfDoc = await pdfService.loadPdf(pdfBuffer);
		pageCount = pdfService.getPageCount(pdfDoc);
		pdfSizeMB = (pdfBuffer.length / (1024 * 1024)).toFixed(2);
		if (pageCount > 60) {
			logger.error(`PDF tiene ${pageCount} páginas, excede el límite de 60.`);
			throw new Error(`PDF tiene ${pageCount} páginas, excede el límite de 60.`);
		}

		// Convertir cada página a imagen
		imagePaths = await pdfService.extractPagesAsImages(tempPdfPath, outputDir, pageCount);

		// Métricas de tiempo
		const startTotal = process.hrtime();
		const limit = pLimit(DEFAULT_CONCURRENCY);
		const results = [];
		let completed = 0;
		const total = imagePaths.length;
		const tasks = imagePaths.map((imagePath, i) => limit(async () => {
			const startPage = process.hrtime();
			const ocrResult = await ocrService.processPageWithOcr(imagePath);
			const pageElapsed = process.hrtime(startPage);
			const pageSeconds = pageElapsed[0] + pageElapsed[1] / 1e9;
			pageProcessDuration.observe(pageSeconds);
			completed++;
			const percent = ((completed / total) * 100).toFixed(1);
			if (ocrResult) {
				results[i] = {
					pageNumber: i + 1,
					text: ocrResult.text,
					confidence: ocrResult.confidence,
					angle: ocrResult.angle,
					osd: ocrResult.osd || false,
					timeSeconds: pageSeconds
				};
			} else {
				results[i] = null;
			}
		}));
		await Promise.all(tasks);
		const elapsedTotal = process.hrtime(startTotal);
		const elapsedSeconds = elapsedTotal[0] + elapsedTotal[1] / 1e9;
		pdfProcessDuration.observe(elapsedSeconds);

		logger.info(`[OCR] PDF procesado correctamente: ${pageCount} páginas, ${pdfSizeMB} MB, tiempo total: ${elapsedSeconds.toFixed(2)}s`);
		return res.json({
			pages: results.filter(r => r),
			pdfProcessSeconds: elapsedSeconds
		});
	} catch (err) {
		logger.error('[OCR] Error procesando PDF:', err);
		if (err.message && err.message.includes('excede el límite de 60')) {
			return res.status(400).json({ error: err.message });
		}
		return res.status(500).json({ error: err.message || "Error processing PDF" });
	} finally {
		// Limpieza robusta de archivos temporales
		try {
			if (Array.isArray(imagePaths) && imagePaths.length > 0) {
				pdfService.cleanupTempImages(outputDir);
			}
		} catch (cleanupErr) {
			logger.error('[CLEANUP] Error al limpiar imágenes temporales:', cleanupErr);
		}
		try {
			if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
		} catch (cleanupErr) {
			logger.error('[CLEANUP] Error al eliminar PDF temporal:', cleanupErr);
		}
	}
});

// Endpoint de salud
app.get('/health', async (req, res) => {
	// Verificar Tesseract
	const tesseractOk = await new Promise(resolve => {
		const { spawn } = require('child_process');
		const proc = spawn('tesseract', ['--version']);
		proc.on('error', () => resolve(false));
		proc.on('close', code => resolve(code === 0));
	});

	// Verificar Poppler
	const popplerOk = await new Promise(resolve => {
		const { spawn } = require('child_process');
		const proc = spawn('pdftocairo', ['-v']);
		proc.on('error', () => resolve(false));
		proc.on('close', code => resolve(code === 0));
	});

	// Verificar espacio en disco (>100MB libres)
	let diskOk = false;
	try {
		const { freemem } = require('os');
		const freeMB = freemem() / (1024 * 1024);
		diskOk = freeMB > 100;
	} catch {
		diskOk = false;
	}

	res.json({
		tesseract: tesseractOk,
		poppler: popplerOk,
		diskSpaceOK: diskOk
	});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	logger.info(`Server running on port ${PORT}`);
});
