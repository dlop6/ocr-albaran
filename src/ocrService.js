const fs = require("fs");
const path = require("path");
const Tesseract = require("tesseract.js");
const sharp = require("sharp");
const { isRelevantPage } = require('./parser');


async function applyOcrToImage(imagePath, lang = "spa+eng", numbersOnly = false) {
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
            if (m.status === 'recognizing text') {
                console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
            }
        }
    };
    
    // Si solo queremos números, usar whitelist
    if (numbersOnly) {
        options.tessedit_char_whitelist = '0123456789';
        options.tessedit_pageseg_mode = 7; // PSM 7: una sola línea de texto
    }
    
    const { data: { text, confidence } } = await Tesseract.recognize(preprocessedPath, lang, options);
    
    console.log(`OCR Confidence: ${confidence}%`);
    
    // Limpiar imagen preprocesada temporal
    if (fs.existsSync(preprocessedPath)) {
        fs.unlinkSync(preprocessedPath);
    }
    
    return { text, confidence };
}

// Rota una imagen en múltiplos de 90 grados
async function rotateImage(imagePath, angle) {
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
    const angles = [0, 90, 180, 270];
    for (const angle of angles) {
        let imgToProcess = imagePath;
        if (angle !== 0) {
            imgToProcess = await rotateImage(imagePath, angle);
        }
        
        // OCR general
        const generalResult = await applyOcrToImage(imgToProcess, lang, false);
        console.log(`OCR en ángulo ${angle}:`);
        console.log(`Texto: ${generalResult.text}`);
        console.log(`Confianza: ${generalResult.confidence}%`);
        
        if (isRelevantPage(generalResult.text)) {
            // Limpia imagen temporal si se creó
            if (angle !== 0 && fs.existsSync(imgToProcess)) {
                fs.unlinkSync(imgToProcess);
            }
            
            return {
                text: generalResult.text,
                confidence: generalResult.confidence,
                angle: angle
            };
        }
        
        // Limpia imagen temporal si se creó
        if (angle !== 0 && fs.existsSync(imgToProcess)) {
            fs.unlinkSync(imgToProcess);
        }
    }
    return null; // Si ningún ángulo es relevante
}

module.exports = {
    applyOcrToImage,
    rotateImage,
    processPageWithOcr
};

