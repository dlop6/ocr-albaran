

/**
 * Normaliza texto: minúsculas, sin tildes, sin caracteres especiales
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
	return str
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "") // quita tildes
		.replace(/[^a-z0-9\s]/g, ""); // solo letras, números y espacios
}

/**
 * Valida si el texto contiene keywords que indican orientación correcta del documento
 * optimizado para tolerar variantes de ocr y errores comunes
 * @param {string} text - Texto OCR de la página
 * @param {string} lang - 'spa' o 'eng'
 * @returns {boolean} true si contiene keywords de documento válido
 */
function hasValidOrientation(text, lang) {
	if (!text || text.length < 10) return false;

	const normalizedText = normalize(text);

	if (lang === 'spa') {
		// regex original que funciona - revertido temporalmente
		return /detalles?\s*recibo/i.test(text) ||
		       /detalles?\s*de\s*recibo/i.test(text) ||
		       /detalles?\s*del?\s*recibo/i.test(text);
	} else if (lang === 'eng') {
		return /proof\s*of\s*receipt/i.test(text) ||
		       /proof\s*of\s*delivery/i.test(text) ||
		       /receipt\s*details/i.test(text);
	}
	return false;
}

/**
 * Determina si una página es relevante según palabras clave o regex
 * @param {string} text - Texto OCR de la página
 * @param {Array<string|RegExp>} [keywords] - Palabras clave o regex (opcional)
 * @returns {boolean}
 */
function isRelevantPage(text, keywords) {
	const defaultKeywords = [
		/detalles?\s*recibo/i,
		/proof\s*of\s*receipt/i,
		/proof\s*of\s*delivery/i
	];
	const patterns = keywords && keywords.length > 0 ? keywords : defaultKeywords;
	const normText = normalize(text);
	return patterns.some(kw => {
		if (kw instanceof RegExp) {
			return kw.test(text) || kw.test(normText);
		} else {
			const normKw = normalize(kw);
			return normText.includes(normKw);
		}
	});
}

/**
 * Procesa una página: si es relevante, devuelve el texto y el número de página
 * @param {string} text
 * @param {number} pageNumber
 * @param {Array<string|RegExp>} [keywords] - opcional, si no se provee usa keywords por defecto
 * @returns {object|null}
 */
function parsePage(text, pageNumber, keywords) {
	if (isRelevantPage(text, keywords)) {
		return { pageNumber, text };
	}
	return null;
}

/**
 * Procesa todas las páginas y devuelve solo las relevantes
 * @param {Array<{text: string, pageNumber: number}>} pages
 * @param {Array<string|RegExp>} [keywords] - opcional, si no se provee usa keywords por defecto
 * @returns {Array<{pageNumber: number, text: string}>}
 */
function parseDocument(pages, keywords) {
	return pages
		.map(page => parsePage(page.text, page.pageNumber, keywords))
		.filter(result => result !== null);
}

module.exports = {
	hasValidOrientation,
	isRelevantPage,
	parsePage,
	parseDocument
};
