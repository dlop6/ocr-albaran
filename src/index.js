// OCR Albarán - Punto de entrada principal
// Servidor Express limpio y modular
require('dotenv').config();

const express = require('express');
const logger = require('./logger');
const config = require('./config/env');
const { applyMiddlewares } = require('./config/middlewares');
const routes = require('./routes');

// Crear app Express
const app = express();

// Aplicar todos los middlewares (seguridad, CORS, rate limiting, body parsing, etc.)
applyMiddlewares(app);

// Montar todas las rutas
app.use('/', routes);

// Registrar configuración al iniciar
logger.info(`[CONFIG] OCR_CONCURRENCY: ${config.OCR_CONCURRENCY}`);
logger.info(`[CONFIG] OCR_DPI: ${config.OCR_DPI}`);
logger.info(`[CONFIG] PORT: ${config.PORT}`);
logger.info(`[CONFIG] HTTP_TIMEOUT_MS: ${config.HTTP_TIMEOUT_MS}`);

// Iniciar servidor
app.listen(config.PORT, '0.0.0.0', () => {
	logger.info(`Server running on port ${config.PORT}`);
});

module.exports = app;
