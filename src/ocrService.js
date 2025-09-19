const fs = require("fs");
const path = require("path");
const Tesseract = require("tesseract.js");
const sharp = require("sharp");
const { isRelevantPage } = require('./parser');


async function applyOcrToImage(imagePath, lang = "spa+eng") {
    // Preprocesar imagen antes de OCR
    const ext = path.extname(imagePath);
    const base = path.basename(imagePath, ext);
    const dir = path.dirname(imagePath);
    const preprocessedPath = path.join(dir, `${base}_preprocessed${ext}`);
    await sharp(imagePath)
        .resize({ width: 2000 }) // Ajusta según calidad original
        .sharpen()
        .normalize()
        .toFile(preprocessedPath);
    const { data: { text } } = await Tesseract.recognize(imagePath, lang, {
    });
    return text;
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
        const text = await applyOcrToImage(imgToProcess, lang);
        console.log(`OCR en ángulo ${angle}:`);
        console.log(text);
        if (isRelevantPage(text)) {
            // Limpia imagen temporal si se creó
            if (angle !== 0 && fs.existsSync(imgToProcess)) {
                fs.unlinkSync(imgToProcess);
            }
            return text;
        }
        // Limpia imagen temporal si se creó
        if (angle !== 0 && fs.existsSync(imgToProcess)) {
            fs.unlinkSync(imgToProcess);
        }
    }
    return ""; // Si ningún ángulo es relevante
}

module.exports = {
    applyOcrToImage,
    rotateImage,
    processPageWithOcr
};

