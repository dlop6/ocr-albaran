const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const Poppler = require('pdf-poppler');

// carga el archivo
async function loadPdf(input) {
	if (Buffer.isBuffer(input)) {
		return await PDFDocument.load(input);
	} else if (typeof input === 'string') {
		return await PDFDocument.load(fs.readFileSync(input));
	}
	throw new Error('Invalid PDF input');
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
	const options = {
		format: 'png',
		out_dir: outputDir,
		out_prefix: path.basename('page'),
		page: null
	};
	const results = [];
	for (let i = 1; i <= noPages; i++) {
		options.page = i;
		try {
			await Poppler.convert(pdfPath, options);
			results.push(path.join(outputDir, `page-${i}.png`));
		} catch (err) {
			console.error(`Error converting page ${i}:`, err);
		}
	}
	return results;
}

// Elimina imágenes temporales
function cleanupTempImages(outputDir) {
	if (fs.existsSync(outputDir)) {
		const files = fs.readdirSync(outputDir);
		files.forEach(file => {
			if (file.endsWith('.png')) {
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
		} else if (typeof input === 'string') {
			PDFDocument.load(fs.readFileSync(input));
		} else {
			throw new Error('Invalid PDF input');
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
