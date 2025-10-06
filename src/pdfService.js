
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

// Convierte cada página en imagen y guarda en outputDir usando Python/pymupdf
// pdfPath: ruta al archivo PDF
// noPages: número de páginas
async function extractPagesAsImages(pdfPath, outputDir, noPages) {
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir);
	}

	try {
		// Invocar script Python según diseño documentado
		const pythonScriptPath = path.join(__dirname, 'pdf2images.py');
		
		// Validar que el script Python existe
		if (!fs.existsSync(pythonScriptPath)) {
			throw new Error(`Script Python no encontrado: ${pythonScriptPath}`);
		}

		// Configurar timeout según diseño (60 segundos)
		const TIMEOUT_MS = 60000;
		
		// Crear promesa para manejar timeout
		const timeoutPromise = new Promise((_, reject) => {
			setTimeout(() => reject(new Error('Timeout: La conversión PDF excedió 60 segundos')), TIMEOUT_MS);
		});

		// Crear promesa para la ejecución del script Python
		const conversionPromise = new Promise((resolve, reject) => {
			const args = [pythonScriptPath, pdfPath, outputDir];
			const proc = spawn('python', args);
			
			let stdout = '';
			let stderr = '';
			
			proc.stdout.on('data', data => {
				stdout += data.toString();
			});
			
			proc.stderr.on('data', data => {
				stderr += data.toString();
			});
			
			proc.on('close', code => {
				try {
					if (code !== 0) {
						// Error en el script Python
						const errorInfo = {
							exitCode: code,
							stderr: stderr.trim(),
							stdout: stdout.trim()
						};
						logger.error(`[Python] Script falló con código ${code}. stderr: ${stderr}`);
						reject(new Error(`Script Python falló con código ${code}: ${stderr || 'Error desconocido'}`));
						return;
					}

					// Parsear JSON de stdout según diseño
					if (!stdout.trim()) {
						reject(new Error('Script Python no devolvió salida JSON'));
						return;
					}

					let result;
					try {
						result = JSON.parse(stdout.trim());
					} catch (parseErr) {
						logger.error(`[Python] Error parseando JSON: ${parseErr}. stdout: ${stdout}`);
						reject(new Error(`JSON inválido del script Python: ${parseErr.message}`));
						return;
					}

					// Validar estructura del JSON según diseño
					if (!result.images || !Array.isArray(result.images)) {
						reject(new Error('JSON del script Python no contiene array "images"'));
						return;
					}

					logger.info(`[Python] Conversión exitosa: ${result.images.length} imágenes generadas`);
					resolve(result.images);

				} catch (err) {
					reject(err);
				}
			});

			proc.on('error', err => {
				logger.error(`[Python] Error ejecutando script: ${err}`);
				reject(new Error(`Error ejecutando Python: ${err.message}`));
			});
		});

		// Ejecutar con timeout
		const imagePaths = await Promise.race([conversionPromise, timeoutPromise]);
		
		// Validar que se generaron las imágenes esperadas
		if (!imagePaths || imagePaths.length === 0) {
			throw new Error('No se generaron imágenes desde el script Python');
		}

		// Validar que los archivos existen físicamente
		for (const imgPath of imagePaths) {
			if (!fs.existsSync(imgPath)) {
				throw new Error(`Imagen reportada pero no encontrada: ${imgPath}`);
			}
		}

		logger.info(`[Python] Conversión completada: ${imagePaths.length} páginas procesadas`);
		return imagePaths;

	} catch (err) {
		logger.error(`[Python] Error en conversión PDF a imágenes: ${err.message}`);
		
		// Implementar reintento según diseño (máximo 1 reintento)
		if (!err.isRetry) {
			logger.info(`[Python] Reintentando conversión una vez...`);
			const retryError = new Error(err.message);
			retryError.isRetry = true;
			
			try {
				return await extractPagesAsImages(pdfPath, outputDir, noPages);
			} catch (retryErr) {
				logger.error(`[Python] Reintento también falló: ${retryErr.message}`);
				throw new Error(`Conversión PDF falló después de reintento: ${retryErr.message}`);
			}
		}
		
		throw err;
	}
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
