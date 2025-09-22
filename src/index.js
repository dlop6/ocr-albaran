const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const pdfService = require("./pdfService");
const ocrService = require("./ocrService");
const parser = require("./parser");
const fieldExtractor = require("./fieldExtractor");

const app = express();
app.use(bodyParser.json({ limit: "100mb" }));

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

		// Procesar cada imagen: OCR + parser
		const results = [];
		for (let i = 0; i < imagePaths.length; i++) {
			const imagePath = imagePaths[i];
			const ocrResult = await ocrService.processPageWithOcr(imagePath);
			console.log(`--- Página ${i + 1} ---`);
			
			if (ocrResult) {
				console.log("Texto extraído:");
				console.log(ocrResult.text);
				console.log(`Confianza: ${ocrResult.confidence}%`);
				console.log(`Ángulo usado: ${ocrResult.angle}°`);
				console.log("¿Es relevante?", true);
				
				results.push({
					pageNumber: i + 1,
					text: ocrResult.text,
					confidence: ocrResult.confidence,
					angle: ocrResult.angle
				});
			} else {
				console.log("Página no relevante en ningún ángulo");
			}
		}

		// Limpiar archivos temporales
		pdfService.cleanupTempImages(outputDir);
		if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);

		return res.json({ pages: results });
	} catch (err) {
		// Limpiar en caso de error
		if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
		pdfService.cleanupTempImages(path.join(__dirname, "temp_images"));
		console.error('Error procesando PDF:', err.message);
		if (err.stack) console.error(err.stack);
		return res.status(500).json({ error: err.message || "Error processing PDF" });
	}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});
