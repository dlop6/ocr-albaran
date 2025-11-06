// Definición de métricas Prometheus
const promClient = require('prom-client');

// Histograma de duración del procesamiento de PDF
const pdfProcessDuration = new promClient.Histogram({
	name: 'pdf_process_duration_seconds',
	help: 'Duración total del procesamiento de PDF (segundos)',
	buckets: [1, 5, 10, 20, 30, 60, 120, 300, 600]
});

// Histograma de duración del procesamiento de página
const pageProcessDuration = new promClient.Histogram({
	name: 'page_process_duration_seconds',
	help: 'Duración del procesamiento de página (segundos)',
	buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 30, 60]
});

// Contador de peticiones HTTP
const httpRequestCounter = new promClient.Counter({
	name: 'http_requests_total',
	help: 'Total de requests HTTP',
	labelNames: ['method', 'route', 'status']
});

// Histograma de duración de peticiones HTTP
const httpRequestDuration = new promClient.Histogram({
	name: 'http_request_duration_seconds',
	help: 'Duración de requests HTTP en segundos',
	labelNames: ['method', 'route', 'status']
});

// Registrar métricas por defecto (memoria, CPU, etc.)
promClient.collectDefaultMetrics();

module.exports = {
	promClient,
	pdfProcessDuration,
	pageProcessDuration,
	httpRequestCounter,
	httpRequestDuration,
};
