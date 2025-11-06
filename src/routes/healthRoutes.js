// Rutas para health check y métricas
const express = require('express');
const router = express.Router();
const logger = require('../logger');
const { promClient } = require('../config/metrics');

// GET /metrics - Endpoint de métricas Prometheus
router.get('/metrics', async (req, res) => {
	try {
		res.set('Content-Type', promClient.register.contentType);
		res.end(await promClient.register.metrics());
	} catch (err) {
		logger.error('[METRICS] Error al obtener métricas:', err);
		res.status(500).end(err.message || 'Error getting metrics');
	}
});

// GET /health - Endpoint de health check
router.get('/health', (req, res) => {
	res.json({
		status: 'ok',
		timestamp: new Date().toISOString()
	});
});

module.exports = router;
