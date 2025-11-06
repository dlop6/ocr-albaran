// Configuración de middlewares de Express
const helmet = require('helmet');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const logger = require('../logger');
const config = require('./env');
const { httpRequestCounter, httpRequestDuration } = require('./metrics');

// Configurar middleware de rate limiting
function createRateLimiter() {
	return rateLimit({
		windowMs: config.RATE_LIMIT_WINDOW_MS,
		max: config.RATE_LIMIT_MAX,
		standardHeaders: true,
		legacyHeaders: false,
		message: {
			error: 'Demasiadas peticiones desde esta IP. Intenta de nuevo más tarde.'
		},
		keyGenerator: (req) => {
			return req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
		}
	});
}

// Configurar middleware de CORS
function createCorsMiddleware() {
	return cors({
		origin: function (origin, callback) {
			// Permitir peticiones sin origin (curl, Postman, etc.)
			if (!origin) return callback(null, true);
			if (config.ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
			return callback(new Error('CORS: Origin not allowed: ' + origin));
		}
	});
}

// Configurar middleware de timeout de peticiones
function createTimeoutMiddleware() {
	return (req, res, next) => {
		res.setTimeout(config.HTTP_TIMEOUT_MS, () => {
			logger.error(`[HTTP] Timeout alcanzado (${config.HTTP_TIMEOUT_MS} ms) para ${req.method} ${req.originalUrl}`);
			if (!res.headersSent) {
				res.status(503).json({ 
					error: `Timeout: la operación excedió ${Math.round(config.HTTP_TIMEOUT_MS / 60000)} minutos.` 
				});
			}
		});
		next();
	};
}

// Configurar middleware para tracking de métricas
function createMetricsMiddleware() {
	return (req, res, next) => {
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
	};
}

// Aplicar todos los middlewares a la app de Express
function applyMiddlewares(app) {
	// Seguridad
	app.use(helmet());
	
	// Rate limiting
	app.use(createRateLimiter());
	
	// Configuración de trust proxy (para detección de IP en rate limiter)
	app.set('trust proxy', false);
	
	// CORS
	app.use(createCorsMiddleware());
	
	// Body parsing
	app.use(bodyParser.json({ limit: '100mb' }));
	app.use(bodyParser.urlencoded({ extended: true }));
	
	// Timeout de peticiones
	app.use(createTimeoutMiddleware());
	
	// Tracking de métricas
	app.use(createMetricsMiddleware());
}

module.exports = {
	applyMiddlewares,
	createRateLimiter,
	createCorsMiddleware,
	createTimeoutMiddleware,
	createMetricsMiddleware,
};
