const fs = require("fs");
const path = require("path");
const Tesseract = require("tesseract.js");
const sharp = require("sharp");
const { isRelevantPage } = require('./parser');

const execa = require('execa');

/**
 * Ejecuta OSD con Tesseract CLI y devuelve el ángulo detectado (0, 90, 180, 270) o null si falla.
 * @param {string} imagePath - Ruta de la imagen a analizar
 * @returns {Promise<number|null>} - Ángulo detectado o null
 */
async function detectOrientationWithOSD(imagePath) {
    try {
    // Ejecuta Tesseract CLI con OSD
    // --psm 0 activa OSD, -l osd usa el modelo de orientación
    const { stdout } = await execa('tesseract', [imagePath, 'stdout', '--psm', '0', '-l', 'osd']);
    // Buscar la línea de orientación en la salida
    // Ejemplo: "Orientation in degrees: 90"
        const match = stdout.match(/Orientation in degrees:\s*(\d+)/);
        if (match) {
            const angle = parseInt(match[1], 10);
            if ([0, 90, 180, 270].includes(angle)) {
                return angle;
            }
        }
        return null;
    } catch (err) {
        console.warn(`[OSD] Error ejecutando OSD: ${err.message}`);
        return null;
    }
}


async function applyOcrToImage(imagePath, lang = "spa+eng", numbersOnly = false) {
    // Detectar tamaño de imagen antes de preprocesar
    const metadata = await sharp(imagePath).metadata();
    let imageTooSmall = false;
    if (metadata.width < 10 || metadata.height < 10) {
        imageTooSmall = true;
        console.warn(`[OCR] Imagen demasiado pequeña (${metadata.width}x${metadata.height}), se procesa igual: ${imagePath}`);
    }
    let almostBlank = false;
    // Detección de página casi en blanco
    try {
        const threshold = 240; // valor para considerar "blanco"
        const img = await sharp(imagePath).greyscale().raw().toBuffer({ resolveWithObject: true });
        const totalPixels = img.info.width * img.info.height;
        let whitePixels = 0;
        for (let i = 0; i < img.data.length; i++) {
            if (img.data[i] > threshold) whitePixels++;
        }
        const percentWhite = (whitePixels / totalPixels) * 100;
        if (percentWhite > 98) {
            almostBlank = true;
            console.warn(`[OCR] Página casi en blanco (${percentWhite.toFixed(2)}% blanco): ${imagePath}`);
        }
    } catch (err) {
        console.warn(`[OCR] No se pudo analizar si la página es casi en blanco: ${imagePath}`);
    }

    // Preprocesar imagen antes de OCR de forma conservadora
    const ext = path.extname(imagePath);
    const base = path.basename(imagePath, ext);
    const dir = path.dirname(imagePath);
    const preprocessedPath = path.join(dir, `${base}_preprocessed${ext}`);

    // Preprocesamiento suave: solo resize y sharpen
    await sharp(imagePath)
        .resize({ width: 2000 }) // Resolución moderada
        .sharpen({ sigma: 1.0 }) // Nitidez suave
        .normalize() // Normalizar contraste
        .toFile(preprocessedPath);

    // Configurar Tesseract
    const options = {
        logger: m => {
            
        }
    };

    // Si solo queremos números, usar whitelist
    if (numbersOnly) {
        options.tessedit_char_whitelist = '0123456789';
        options.tessedit_pageseg_mode = 7; // PSM 7: una sola línea de texto
    }

    const { data: { text, confidence } } = await Tesseract.recognize(preprocessedPath, lang, options);
    // Limpiar imagen preprocesada temporal
    if (fs.existsSync(preprocessedPath)) {
        fs.unlinkSync(preprocessedPath);
    }
    return { text, confidence, imageTooSmall, almostBlank, width: metadata.width, height: metadata.height };
}

// Rota una imagen en múltiplos de 90 grados
/**
 * Rota la imagen al ángulo indicado (solo 0, 90, 180, 270). Si ángulo es 0, retorna la imagen original.
 * @param {string} imagePath - Ruta de la imagen
 * @param {number} angle - Ángulo de rotación (0, 90, 180, 270)
 * @returns {Promise<string>} - Ruta de la imagen rotada
 */
async function rotateImage(imagePath, angle) {
    if (![0, 90, 180, 270].includes(angle)) {
        throw new Error(`Ángulo de rotación no permitido: ${angle}`);
    }
    if (angle === 0) {
        // No rotar, retornar imagen original
        return imagePath;
    }
    const ext = path.extname(imagePath);
    const base = path.basename(imagePath, ext);
    const dir = path.dirname(imagePath);
    const rotatedPath = path.join(dir, `${base}_rot${angle}${ext}`);
    await sharp(imagePath)
        .rotate(angle)
        .toFile(rotatedPath);
    return rotatedPath;
}

// Procesa una página: rota y aplica OCR hasta que sea legible
async function processPageWithOcr(imagePath, lang = "spa+eng") {
    // Intentar OSD primero
    let angle = await detectOrientationWithOSD(imagePath);
    let imgToProcess = imagePath;
    let triedAngles = [];
    if (angle !== null && [0, 90, 180, 270].includes(angle)) {
        triedAngles.push(angle);
        // Rotar solo si es necesario
        if (angle !== 0) {
            imgToProcess = await rotateImage(imagePath, angle);
        }
        // OCR general
        const generalResult = await applyOcrToImage(imgToProcess, lang, false);
        console.log(`[OSD] Ángulo detectado: ${angle}`);
        if (isRelevantPage(generalResult.text)) {
            if (angle !== 0 && fs.existsSync(imgToProcess)) {
                fs.unlinkSync(imgToProcess);
            }
            return {
                text: generalResult.text,
                confidence: generalResult.confidence,
                angle: angle,
                osd: true
            };
        }
        if (angle !== 0 && fs.existsSync(imgToProcess)) {
            fs.unlinkSync(imgToProcess);
        }
    }
    // Si OSD falla o no es relevante, rotar por fuerza bruta
    const fallbackAngles = [0, 90, 180, 270].filter(a => !triedAngles.includes(a));
    for (const fallbackAngle of fallbackAngles) {
        let fallbackImg = imagePath;
        if (fallbackAngle !== 0) {
            fallbackImg = await rotateImage(imagePath, fallbackAngle);
        }
        const generalResult = await applyOcrToImage(fallbackImg, lang, false);
        console.log(`[Fallback] OCR en ángulo ${fallbackAngle}:`);
        if (isRelevantPage(generalResult.text)) {
            if (fallbackAngle !== 0 && fs.existsSync(fallbackImg)) {
                fs.unlinkSync(fallbackImg);
            }
            return {
                text: generalResult.text,
                confidence: generalResult.confidence,
                angle: fallbackAngle,
                osd: false
            };
        }
        if (fallbackAngle !== 0 && fs.existsSync(fallbackImg)) {
            fs.unlinkSync(fallbackImg);
        }
    }
    return null; // Si ningún ángulo es relevante
}

module.exports = {
    applyOcrToImage,
    rotateImage,
    processPageWithOcr,
    detectOrientationWithOSD
};

