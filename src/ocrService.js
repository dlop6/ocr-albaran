const fs = require("fs");
const path = require("path");
const Tesseract = require("tesseract.js");
const sharp = require("sharp");
const logger = require('./logger');
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
 
        const match = stdout.match(/Orientation in degrees:\s*(\d+)/);
        if (match) {
            const angle = parseInt(match[1], 10);
            if ([0, 90, 180, 270].includes(angle)) {
                return angle;
            }
        }
        return null;
    } catch (err) {
        logger.warn(`[OSD] Error ejecutando OSD: ${err.message}`);
        return null;
    }
}

/**
 * Preprocesa la imagen teniendo en cuenta el DPI original y genera buffers
 * compartidos (normalizado y binarizado) junto con estadísticas para detección
 * de páginas en blanco.
 *
 * @param {string} imagePath
 * @param {object} [options]
 * @param {number} [options.targetDpi]
 * @param {number} [options.minScale]
 * @param {number} [options.maxScale]
 * @param {number} [options.binaryThreshold]
 * @returns {Promise<object>}
 */
async function preprocessImage(imagePath, options = {}) {
    const {
        targetDpi = Number(process.env.OCR_TARGET_DPI || 300),
        minScale = Number(process.env.OCR_MIN_SCALE || 0.7),
        maxScale = Number(process.env.OCR_MAX_SCALE || 3.0),
        binaryThreshold = Number(options.binaryThreshold ?? process.env.OCR_BINARY_THRESHOLD ?? 245)
    } = options;

    const base = sharp(imagePath, { sequentialRead: true });
    const metadata = await base.metadata();
    const width = metadata.width || null;
    const height = metadata.height || null;
    const density = metadata.density && isFinite(metadata.density) && metadata.density > 0
        ? metadata.density
        : null;

    let scale = 1;
    if (density) {
        scale = targetDpi / density;
    }
    if (!isFinite(scale) || scale <= 0) {
        scale = 1;
    }
    scale = Math.min(maxScale, Math.max(minScale, scale));

    let resizeWidth = null;
    if (width) {
        resizeWidth = Math.max(1, Math.round(width * scale));
    }

    let pipeline = base.clone();
    if (resizeWidth && width) {
        pipeline = pipeline.resize({
            width: resizeWidth,
            fit: 'inside',
            withoutEnlargement: false
        });
    }

    pipeline = pipeline
        .greyscale()
        .gamma()
        .normalize()
        .sharpen({ sigma: 1.0 })
        .modulate({ brightness: 1.05 })
        .png();

    const { data: processedBuffer, info: processedInfo } = await pipeline.toBuffer({ resolveWithObject: true });

    const binarizedPipeline = sharp(processedBuffer, { sequentialRead: true })
        .threshold(binaryThreshold)
        .png();

    const [binaryResult, stats] = await Promise.all([
        binarizedPipeline.clone().toBuffer({ resolveWithObject: true }),
        binarizedPipeline.clone().stats()
    ]);

    const imageTooSmall = Boolean(width && height && (width < 10 || height < 10));

    return {
        originalPath: imagePath,
        metadata,
        target: {
            dpi: targetDpi,
            density,
            scale,
            width: processedInfo.width,
            height: processedInfo.height
        },
        processed: {
            buffer: processedBuffer,
            info: processedInfo
        },
        binarized: {
            buffer: binaryResult.data,
            info: binaryResult.info,
            stats,
            threshold: binaryThreshold
        },
        imageTooSmall
    };
}


// lang debe ser 'spa' o 'eng' según input, nunca autodetectar ni usar ambos
async function applyOcrToImage(imagePath, lang = "spa", numbersOnly = false, preprocessResult = null) {
    let preprocessing = null;
    if (preprocessResult && preprocessResult.originalPath === imagePath) {
        preprocessing = preprocessResult;
    } else {
        preprocessing = await preprocessImage(imagePath, {
            binaryThreshold: preprocessResult && preprocessResult.binarized
                ? preprocessResult.binarized.threshold
                : undefined
        });
    }

    const metadata = preprocessing.metadata || {};
    const imageTooSmall = preprocessing.imageTooSmall;

    // Preferir buffer binarizado cuando solo se necesitan números para maximizar contraste
    const bufferForOcr = (numbersOnly && preprocessing.binarized && preprocessing.binarized.buffer)
        ? preprocessing.binarized.buffer
        : preprocessing.processed.buffer;

    // Configurar Tesseract
    const options = {
        logger: m => {}
    };

    // Si solo queremos números, usar whitelist
    if (numbersOnly) {
        options.tessedit_char_whitelist = '0123456789';
        options.tessedit_pageseg_mode = 7; // PSM 7: una sola línea de texto
    }

    const { data: { text, confidence } } = await Tesseract.recognize(bufferForOcr, lang, options);
    // Liberar buffer explícitamente
    if (global.gc) global.gc();
    return { text, confidence, imageTooSmall, width: metadata.width, height: metadata.height, preprocessing };
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
    // Guard: comprobar metadata y dimensiones mínimas antes de rotar
    try {
        const meta = await sharp(imagePath).metadata();
        const minDim = parseInt(process.env.MIN_IMAGE_DIM || '120', 10);
        if (!meta || !meta.width || !meta.height) {
            logger.warn(`[ROTATE GUARD] metadata missing for ${imagePath}, skipping rotate ${angle}`);
            return imagePath;
        }
        if (meta.width < minDim || meta.height < minDim) {
            logger.warn(`[ROTATE GUARD] image too small (w:${meta.width} h:${meta.height}) for rotate ${angle}, skipping`);
            return imagePath;
        }

        // Usar sharp directamente para crear la imagen rotada
        await sharp(imagePath).rotate(angle).toFile(rotatedPath);
        return rotatedPath;
    } catch (err) {
        logger.warn(`[ROTATE GUARD] failed rotating ${imagePath} by ${angle}: ${err.message}. Using original image.`);
        return imagePath;
    }
}

// Procesa una página: rota y aplica OCR hasta que sea legible
// lang debe ser 'spa' o 'eng' según input
// quickOcrResult: resultado opcional de quick-OCR para reutilización
// preprocessResult: resultado de preprocesado compartido (sin rotación)
async function processPageWithOcr(imagePath, lang = "spa", quickOcrResult = null, preprocessResult = null) {
    const { hasValidOrientation } = require('./parser');

    let basePreprocess = null;
    if (preprocessResult && preprocessResult.originalPath === imagePath) {
        basePreprocess = preprocessResult;
    } else if (quickOcrResult && quickOcrResult.preprocessing && quickOcrResult.preprocessing.originalPath === imagePath) {
        basePreprocess = quickOcrResult.preprocessing;
    }

    // OPTIMIZACIÓN 1: Reutilizar resultado de quick-OCR si es válido
    if (quickOcrResult && quickOcrResult.text && quickOcrResult.text.length > 30) {
        if (hasValidOrientation(quickOcrResult.text, lang)) {
            logger.info(`[OCR CACHE] Reutilizando resultado quick-OCR para ${imagePath} (${quickOcrResult.text.length} chars)`);
            return quickOcrResult;
        }
        logger.info(`[OCR CACHE] Quick-OCR no validó keywords, continuando con procesamiento normal...`);
    }

    // PASO 1: Intentar OSD primero
    let angle = await detectOrientationWithOSD(imagePath);
    let rotatedPath = imagePath;
    let createdRotated = false;
    
    if (angle !== null && angle !== 0) {
        try {
            rotatedPath = await rotateImage(imagePath, angle);
            createdRotated = true;
        } catch (err) {
            logger.warn(`[OSD] No se pudo rotar imagen: ${err.message}`);
            rotatedPath = imagePath;
        }
    }

    // OCR con ángulo detectado por OSD
    const osdPreprocess = angle === 0 ? basePreprocess : null;
    const osdResult = await applyOcrToImage(rotatedPath, lang, false, osdPreprocess);
    logger.info(`[OSD] Ángulo detectado: ${angle}°`);
    
    // Limpiar imagen rotada temporal inmediatamente
    if (createdRotated && rotatedPath && fs.existsSync(rotatedPath)) {
        try { 
            fs.unlinkSync(rotatedPath); 
        } catch (e) { 
            logger.warn(`[CLEANUP] Error eliminando ${rotatedPath}: ${e.message}`);
        }
    }

    // VALIDACIÓN OSD: Verificar si el ángulo detectado es correcto
    if (hasValidOrientation(osdResult.text, lang)) {
        logger.info(`[OSD VALID] Ángulo ${angle}° validado con keywords correctas ✓`);
        return {
            text: osdResult.text,
            confidence: osdResult.confidence,
            angle: angle || 0,
            osd: true
        };
    }

    // PASO 2: OSD no validó → Fallback inteligente
    logger.warn(`[OSD INVALID] Ángulo ${angle}° no validó keywords. Iniciando fallback...`);
    
    const triedAngles = [angle];
    const fallbackAngles = [0, 90, 180, 270].filter(a => !triedAngles.includes(a));
    
    for (const fallbackAngle of fallbackAngles) {
        let fallbackPath = imagePath;
        let createdFallback = false;
        
        if (fallbackAngle !== 0) {
            try {
                fallbackPath = await rotateImage(imagePath, fallbackAngle);
                createdFallback = true;
            } catch (err) {
                logger.warn(`[FALLBACK] Error rotando a ${fallbackAngle}°: ${err.message}`);
                continue;
            }
        }

        const fallbackPreprocess = fallbackAngle === 0 ? basePreprocess : null;
        const fallbackResult = await applyOcrToImage(fallbackPath, lang, false, fallbackPreprocess);
        
        // Limpiar imagen rotada temporal inmediatamente
        if (createdFallback && fallbackPath && fs.existsSync(fallbackPath)) {
            try { 
                fs.unlinkSync(fallbackPath); 
            } catch (e) { 
                logger.warn(`[CLEANUP] Error eliminando ${fallbackPath}: ${e.message}`);
            }
        }

        // Validar con keywords
        if (hasValidOrientation(fallbackResult.text, lang)) {
            logger.info(`[FALLBACK VALID] Ángulo ${fallbackAngle}° validado con keywords correctas ✓`);
            return {
                text: fallbackResult.text,
                confidence: fallbackResult.confidence,
                angle: fallbackAngle,
                osd: false
            };
        }
        
        logger.info(`[FALLBACK] Ángulo ${fallbackAngle}° no validó keywords, probando siguiente...`);
    }

    // PASO 3: Ningún ángulo validó keywords → devolver mejor resultado (OSD)
    logger.warn(`[FALLBACK END] Ningún ángulo validó keywords para ${imagePath}. Usando resultado OSD.`);
    return {
        text: osdResult.text,
        confidence: osdResult.confidence,
        angle: angle || 0,
        osd: true
    };
}

module.exports = {
    applyOcrToImage,
    rotateImage,
    processPageWithOcr,
    detectOrientationWithOSD,
    preprocessImage
};

