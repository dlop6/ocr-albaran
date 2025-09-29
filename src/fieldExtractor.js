const { applyOcrToImage } = require('./ocrService');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

/**
 * Extrae campos específicos de una región de imagen usando OCR optimizado
 */
async function extractFieldFromRegion(imagePath, fieldName, boundingBox = null, numbersOnly = false) {
    let processedImagePath = imagePath;
    
    try {
        // Si se especifica una región, recortar la imagen
        if (boundingBox) {
            const ext = path.extname(imagePath);
            const base = path.basename(imagePath, ext);
            const dir = path.dirname(imagePath);
            const croppedPath = path.join(dir, `${base}_crop_${fieldName}${ext}`);
            
            await sharp(imagePath)
                .extract({
                    left: boundingBox.x,
                    top: boundingBox.y,
                    width: boundingBox.width,
                    height: boundingBox.height
                })
                .toFile(croppedPath);
            
            processedImagePath = croppedPath;
        }
        
        // Aplicar OCR específico para el campo
        const result = await applyOcrToImage(processedImagePath, "spa+eng", numbersOnly);
        
        // Limpiar archivo temporal si se creó
        if (boundingBox && fs.existsSync(processedImagePath)) {
            fs.unlinkSync(processedImagePath);
        }
        
        return {
            fieldName,
            value: result.text.trim(),
            confidence: result.confidence,
            numbersOnly
        };
        
    } catch (error) {
            console.error(`Error extracting field ${fieldName}: ${error.message}`);
        
        // Limpiar archivo temporal en caso de error
        if (boundingBox && fs.existsSync(processedImagePath)) {
            fs.unlinkSync(processedImagePath);
        }
        
        return {
            fieldName,
            value: '',
            confidence: 0,
            error: error.message
        };
    }
}

/**
 * Extrae múltiples campos numéricos usando patrones de texto
 */
function extractNumericFields(text, numbersText) {
    const fields = {};
    
    // Buscar patrones comunes
    const patterns = {
        receiver: /receiver\s*\d*:\s*(\d+)/i,
        dept: /dept\s*(\d+)/i,
        poNumber: /po\s*number[:\s-]*(\d+)/i,
        vendor: /vendor:\s*(\d+)/i,
        phone: /phone:\s*([\d\s-]+)/i
    };
    
    // Extraer usando texto general
    for (const [fieldName, pattern] of Object.entries(patterns)) {
        const match = text.match(pattern);
        if (match) {
            fields[fieldName] = {
                value: match[1].trim(),
                source: 'general_ocr',
                confidence: 'medium'
            };
        }
    }
    
    // También extraer todos los números encontrados en el OCR solo de números
    if (numbersText) {
        const numbers = numbersText.match(/\d+/g) || [];
        fields.allNumbers = {
            value: numbers,
            source: 'numbers_ocr',
            confidence: 'high'
        };
    }
    
    return fields;
}

module.exports = {
    extractFieldFromRegion,
    extractNumericFields
};