// Detecta si el texto contiene las palabras clave
function isRelevantPage(text) {
	const keywords = [
		"detalles recibo",
		"proof of delivery"
	];
	const lowerText = text.toLowerCase();
	return keywords.some(keyword => lowerText.includes(keyword));
}

// Procesa una página: si es relevante, devuelve el texto y el número de página
function parsePage(text, pageNumber) {
	if (isRelevantPage(text)) {
		return { pageNumber, text };
	}
	return null;
}

// Procesa todas las páginas y devuelve solo las relevantes
function parseDocument(pages) {
	// pages: array de { text, pageNumber }
	return pages
		.map(page => parsePage(page.text, page.pageNumber))
		.filter(result => result !== null);
}

module.exports = {
	isRelevantPage,
	parsePage,
	parseDocument
};
