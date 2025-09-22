const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const pdfService = require("./pdfService");
const ocrService = require("./ocrService");
const parser = require("./parser");
const fieldExtractor = require("./fieldExtractor");
const pLimit = require("p-limit").default;

const app = express();
app.use(bodyParser.json({ limit: "100mb" }));

// Valor de concurrencia configurable
const DEFAULT_CONCURRENCY = process.env.OCR_CONCURRENCY ? parseInt(process.env.OCR_CONCURRENCY) : 5;

app.post("/api/process-pdf", async (req, res) => {
	const { pdfBase64 } = req.body;
	if (!pdfBase64) {
		return res.status(400).json({ error: "pdfBase64 is required" });
	}
	// Crear archivo temporal para el PDF
	const tempPdfPath = path.join(__dirname, "temp.pdf");
	try {
		// Decodificar base64 y guardar como archivo
		const pdfBuffer = Buffer.from(pdfBase64, "base64");
		fs.writeFileSync(tempPdfPath, pdfBuffer);

		// Cargar PDF y obtener número de páginas
		const pdfDoc = await pdfService.loadPdf(pdfBuffer);
		const pageCount = pdfService.getPageCount(pdfDoc);
		const pdfSizeMB = (pdfBuffer.length / (1024 * 1024)).toFixed(2);
		console.log(`PDF recibido: ${tempPdfPath}`);
		console.log(`Tamaño: ${pdfSizeMB} MB, páginas: ${pageCount}`);
		if (pageCount > 60) {
			console.error(`PDF tiene ${pageCount} páginas, excede el límite de 60.`);
			if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
			return res.status(400).json({ error: `PDF tiene ${pageCount} páginas, excede el límite de 60.` });
		}

		// Convertir cada página a imagen
		const outputDir = path.join(__dirname, "temp_images");
		const imagePaths = await pdfService.extractPagesAsImages(tempPdfPath, outputDir, pageCount);

		// Métricas de tiempo
		const startTotal = Date.now();
		const limit = pLimit(DEFAULT_CONCURRENCY);
		const results = [];
		let completed = 0;
		const total = imagePaths.length;
		const tasks = imagePaths.map((imagePath, i) => limit(async () => {
			const startPage = Date.now();
			const ocrResult = await ocrService.processPageWithOcr(imagePath);
			const endPage = Date.now();
			const pageTime = ((endPage - startPage) / 1000).toFixed(2);
			completed++;
			const percent = ((completed / total) * 100).toFixed(1);
			if (ocrResult) {
				console.log(`[OCR] Página ${i + 1}/${total} procesada | Confianza: ${ocrResult.confidence}% | Ángulo: ${ocrResult.angle}° | Progreso: ${percent}% | Tiempo: ${pageTime}s`);
				results[i] = {
					pageNumber: i + 1,
					text: ocrResult.text,
					confidence: ocrResult.confidence,
					angle: ocrResult.angle,
					timeSeconds: pageTime
				};
			} else {
				console.log(`[OCR] Página ${i + 1}/${total} no relevante | Progreso: ${percent}% | Tiempo: ${pageTime}s`);
				results[i] = null;
			}
		}));
		await Promise.all(tasks);
		const endTotal = Date.now();
		const totalTime = ((endTotal - startTotal) / 1000).toFixed(2);
		console.log(`[OCR] Tiempo total de procesamiento: ${totalTime}s para ${total} páginas (concurrencia: ${DEFAULT_CONCURRENCY})`);

		// Limpiar archivos temporales
		pdfService.cleanupTempImages(outputDir);
		if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);

	return res.json({ pages: results.filter(r => r) });
	} catch (err) {
		// Limpiar en caso de error
		if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
		pdfService.cleanupTempImages(path.join(__dirname, "temp_images"));
		console.error('[OCR] Error procesando PDF:', err.message);
		if (err.stack) console.error(err.stack);
		return res.status(500).json({ error: err.message || "Error processing PDF" });
	}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});
