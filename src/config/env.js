// Configuración centralizada de variables de entorno

module.exports = {
	// Servidor
	PORT: process.env.PORT || 3000,
	HTTP_TIMEOUT_MS: process.env.HTTP_TIMEOUT_MS
		? parseInt(process.env.HTTP_TIMEOUT_MS, 10)
		: 1600000,

	// Rate limiting
	RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS
		? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10)
		: 15 * 60 * 1000,
	RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX
		? parseInt(process.env.RATE_LIMIT_MAX, 10)
		: 100,

	// CORS
	ALLOWED_ORIGINS: process.env.CORS_ORIGINS
		? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
		: ['http://localhost:3000', 'http://127.0.0.1:3000'],

	// OCR
	OCR_CONCURRENCY: process.env.OCR_CONCURRENCY
		? parseInt(process.env.OCR_CONCURRENCY, 10)
		: 5,
	OCR_DPI: process.env.OCR_DPI || '300',

	// Bizagi
	BIZAGI_BASE_URL: process.env.BIZAGI_BASE_URL || '',
	BIZAGI_TOKEN: process.env.BIZAGI_TOKEN || '',
};
