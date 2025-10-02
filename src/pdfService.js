
const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");
const { spawn } = require('child_process');
const logger = require('./logger');


// carga el archivo
async function loadPdf(input) {
	if (Buffer.isBuffer(input)) {
		return await PDFDocument.load(input);
	} else if (typeof input === "string") {
		return await PDFDocument.load(fs.readFileSync(input));
	}
	throw new Error("Invalid PDF input");
}

// Devuelve el número de páginas del PDF
function getPageCount(pdf) {
	return pdf.getPages().length;
}

// Convierte cada página en imagen y guarda en outputDir
// pdfPath: ruta al archivo PDF
// noPages: número de páginas
async function extractPagesAsImages(pdfPath, outputDir, noPages) {
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir);
	}
	const results = [];
	const pLimit = require('p-limit');
	const DEFAULT_CONCURRENCY = process.env.OCR_CONCURRENCY ? parseInt(process.env.OCR_CONCURRENCY) : 10;
	let completed = 0;
	const total = noPages;
	const limit = pLimit(DEFAULT_CONCURRENCY);
	const tasks = [];
	for (let i = 1; i <= noPages; i++) {
		tasks.push(limit(async () => {
			const imgPath = path.join(outputDir, `page-${i}.png`);
			try {
				// Construir comando pdftocairo
				const args = [
					'-png',
					'-r', '300',
					'-f', String(i),
					'-l', String(i),
					pdfPath,
					path.join(outputDir, 'page')
				];
				const proc = spawn('pdftocairo', args);
				let stdout = '';
				let stderr = '';
				proc.stdout.on('data', data => { stdout += data.toString(); });
				proc.stderr.on('data', data => { stderr += data.toString(); });
				await new Promise((resolve, reject) => {
					proc.on('close', code => {
						if (stdout) logger.info(`[Poppler][stdout][página ${i}]: ${stdout}`);
						if (stderr) logger.error(`[Poppler][stderr][página ${i}]: ${stderr}`);
						if (code !== 0) {
							reject(new Error(`pdftocairo exited with code ${code}`));
						} else {
							resolve();
						}
					});
				});
				if (!fs.existsSync(imgPath)) {
					throw new Error(`Image not generated for page ${i}: ${imgPath}`);
				}
				results[i - 1] = imgPath;
			} catch (err) {
				logger.error(`[Poppler] Error al convertir página ${i}: ${err}`);
				// Fallback: extraer la página con pdf-lib y volver a intentar
				try {
					const tempSinglePdf = path.join(outputDir, `page-${i}-single.pdf`);
					const pdfBytes = fs.readFileSync(pdfPath);
					const pdfDoc = await PDFDocument.load(pdfBytes);
					const newPdf = await PDFDocument.create();
					const copiedPages = await newPdf.copyPages(pdfDoc, [i - 1]);
					newPdf.addPage(copiedPages[0]);
					const newPdfBytes = await newPdf.save();
					fs.writeFileSync(tempSinglePdf, newPdfBytes);
					// Intentar conversión con Poppler nuevamente
					const args2 = [
						'-png',
						'-r', '300',
						'-f', '1',
						'-l', '1',
						tempSinglePdf,
						path.join(outputDir, `page-${i}-single`)
					];
					const proc2 = spawn('pdftocairo', args2);
					let stdout2 = '';
					let stderr2 = '';
					proc2.stdout.on('data', data => { stdout2 += data.toString(); });
					proc2.stderr.on('data', data => { stderr2 += data.toString(); });
					await new Promise((resolve, reject) => {
						proc2.on('close', code => {
							if (stdout2) logger.info(`[Poppler][stdout][fallback página ${i}]: ${stdout2}`);
							if (stderr2) logger.error(`[Poppler][stderr][fallback página ${i}]: ${stderr2}`);
							if (code !== 0) {
								if (fs.existsSync(tempSinglePdf)) {
									fs.unlinkSync(tempSinglePdf);
								}
								reject(new Error(`pdftocairo fallback exited with code ${code}`));
							} else {
								resolve();
							}
						});
					});
					const fallbackImgPath = path.join(outputDir, `page-${i}-single-1.png`);
					if (!fs.existsSync(fallbackImgPath)) {
						if (fs.existsSync(tempSinglePdf)) {
							fs.unlinkSync(tempSinglePdf);
						}
						throw new Error(`Fallback image not generated for page ${i}: ${fallbackImgPath}`);
					}
					if (fs.existsSync(tempSinglePdf)) {
						fs.unlinkSync(tempSinglePdf);
					}
					results[i - 1] = fallbackImgPath;
				} catch (fallbackErr) {
					logger.error(`[Fallback] Error al extraer/converter página ${i}: ${fallbackErr}`);
				}
			}
			completed++;
			const percent = ((completed / total) * 100).toFixed(1);
			logger.info(`[Poppler] Progreso: ${percent}% (${completed}/${total})`);
		}));
	}
	await Promise.all(tasks);
	return results;
}

// Elimina imágenes temporales
function cleanupTempImages(outputDir) {
	if (fs.existsSync(outputDir)) {
		const files = fs.readdirSync(outputDir);
		files.forEach(file => {
			if (file.endsWith(".png")) {
				fs.unlinkSync(path.join(outputDir, file));
			}
		});
		// Opcional: eliminar el directorio si está vacío
		if (fs.readdirSync(outputDir).length === 0) {
			fs.rmdirSync(outputDir);
		}
	}
}

// Verifica que el PDF sea válido
function validatePdf(input) {
	try {
		if (Buffer.isBuffer(input)) {
			PDFDocument.load(input);
		} else if (typeof input === "string") {
			PDFDocument.load(fs.readFileSync(input));
		} else {
			throw new Error("Invalid PDF input");
		}
		return true;
	} catch (err) {
		return false;
	}
}

module.exports = {
	loadPdf,
	getPageCount,
	extractPagesAsImages,
	cleanupTempImages,
	validatePdf
};
