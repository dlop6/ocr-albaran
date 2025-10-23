const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const sharp = require("sharp");
const execa = require('execa');
const promClient = require('prom-client');
const logger = require('./logger');

const CACHE_VERSION = 'v1';
const CACHE_ROOT = path.join(os.tmpdir(), 'ocr-service-cache');
const OCR_CACHE_DIR = path.join(CACHE_ROOT, 'ocr');
const OSD_CACHE_DIR = path.join(CACHE_ROOT, 'osd');

const memoryOcrCache = new Map();
const memoryOsdCache = new Map();

for (const dir of [CACHE_ROOT, OCR_CACHE_DIR, OSD_CACHE_DIR]) {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (err) {
        logger.warn(`[CACHE] No se pudo crear el directorio de caché ${dir}: ${err.message}`);
    }
}

let ocrCliDuration = promClient.register.getSingleMetric('ocr_cli_duration_seconds');
if (!ocrCliDuration) {
    ocrCliDuration = new promClient.Histogram({
        name: 'ocr_cli_duration_seconds',
        help: 'Duración de ejecuciones de Tesseract CLI (segundos)',
        labelNames: ['lang', 'mode'] // mode: full, cache
    });
}

function getFileSignature(imagePath) {
    try {
        const stats = fs.statSync(imagePath);
        return `${stats.size}-${Math.round(stats.mtimeMs)}-${stats.ino || 0}`;
    } catch (err) {
        return null;
    }
}

function buildCacheKey(kind, imagePath, extraParts = []) {
    const signature = getFileSignature(imagePath);
    if (!signature) {
        return { key: null, filePath: null };
    }
    const resolved = path.resolve(imagePath);
    const payload = JSON.stringify([CACHE_VERSION, resolved, signature, ...extraParts]);
    const hash = crypto.createHash('sha1').update(payload).digest('hex');
    const dir = kind === 'osd' ? OSD_CACHE_DIR : OCR_CACHE_DIR;
    return {
        key: `${kind}:${hash}`,
        filePath: path.join(dir, `${hash}.json`)
    };
}

function readCache(keyObj, memoryStore) {
    if (!keyObj || !keyObj.key) return null;
    if (memoryStore.has(keyObj.key)) {
        return memoryStore.get(keyObj.key);
    }
    if (keyObj.filePath && fs.existsSync(keyObj.filePath)) {
        try {
            const raw = fs.readFileSync(keyObj.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            memoryStore.set(keyObj.key, parsed);
            return parsed;
        } catch (err) {
            logger.warn(`[CACHE] Error leyendo ${keyObj.filePath}: ${err.message}`);
        }
    }
    return null;
}

function writeCache(keyObj, memoryStore, value) {
    if (!keyObj || !keyObj.key) return;
    memoryStore.set(keyObj.key, value);
    if (keyObj.filePath) {
        try {
            fs.writeFileSync(keyObj.filePath, JSON.stringify(value));
        } catch (err) {
            logger.warn(`[CACHE] Error escribiendo ${keyObj.filePath}: ${err.message}`);
        }
    }
}

function getCachedOcrResult(imagePath, lang = 'spa', angle = 0, numbersOnly = false) {
    const keyObj = buildCacheKey('ocr', imagePath, [lang, numbersOnly ? 'num' : 'full', angle]);
    const cached = readCache(keyObj, memoryOcrCache);
    return cached ? { ...cached, cacheHit: true } : null;
}

function cacheOcrResult(imagePath, lang, numbersOnly, angle, payload) {
    const keyObj = buildCacheKey('ocr', imagePath, [lang, numbersOnly ? 'num' : 'full', angle]);
    if (!keyObj || !keyObj.key) return;
    const value = { ...payload, cacheHit: undefined };
    delete value.cacheHit;
    writeCache(keyObj, memoryOcrCache, value);
}

function getCachedOrientation(imagePath) {
    const keyObj = buildCacheKey('osd', imagePath, []);
    const cached = readCache(keyObj, memoryOsdCache);
    if (cached && Object.prototype.hasOwnProperty.call(cached, 'angle')) {
        return cached.angle;
    }
    return undefined;
}

function cacheOrientation(imagePath, angle) {
    const keyObj = buildCacheKey('osd', imagePath, []);
    if (!keyObj || !keyObj.key) return;
    writeCache(keyObj, memoryOsdCache, { angle, ts: Date.now() });
}

/**
 * Ejecuta OSD con Tesseract CLI y devuelve el ángulo detectado (0, 90, 180, 270) o null si falla.
 * @param {string} imagePath - Ruta de la imagen a analizar
 * @returns {Promise<number|null>} - Ángulo detectado o null
 */
async function detectOrientationWithOSD(imagePath) {
    const cached = getCachedOrientation(imagePath);
    if (typeof cached === 'number') {
        return cached;
    }

    try {
        const { stdout } = await execa('tesseract', [imagePath, 'stdout', '--psm', '0', '-l', 'osd']);
        const match = stdout.match(/Orientation in degrees:\s*(\d+)/);
        if (match) {
            const angle = parseInt(match[1], 10);
            if ([0, 90, 180, 270].includes(angle)) {
                cacheOrientation(imagePath, angle);
                return angle;
            }
        }
        cacheOrientation(imagePath, null);
        return null;
    } catch (err) {
        logger.warn(`[OSD] Error ejecutando OSD: ${err.message}`);
        return typeof cached === 'number' ? cached : null;
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
async function applyOcrToImage(imagePath, lang = "spa", numbersOnly = false, options = {}) {
    const angle = typeof options.angle === 'number' ? options.angle : 0;
    const cacheImagePath = options.cacheKeyImagePath || imagePath;
    const useCache = options.useCache !== false;

    if (useCache) {
        const cached = getCachedOcrResult(cacheImagePath, lang, angle, numbersOnly);
        if (cached) {
            try {
                ocrCliDuration.observe({ lang, mode: 'cache' }, 0);
            } catch (err) {
                logger.debug(`[METRICS] No se pudo registrar cache-hit OCR: ${err.message}`);
            }
            return cached;
        }
    }

    let metadata = null;
    let imageTooSmall = false;
    try {
        metadata = await sharp(imagePath).metadata();
        if (metadata && metadata.width && metadata.height && (metadata.width < 10 || metadata.height < 10)) {
            imageTooSmall = true;
            logger.warn(`[OCR] Imagen demasiado pequeña (${metadata.width}x${metadata.height}), se procesa igual: ${imagePath}`);
        }
    } catch (err) {
        logger.warn(`[OCR] No se pudo leer metadata de ${imagePath}: ${err.message}`);
    }

    const tmpOutput = path.join(os.tmpdir(), `ocr-cli-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
    let workingPath = imagePath;
    let cleanupTmp = false;

    try {
        await sharp(imagePath)
            .resize({ width: 2000 })
            .sharpen({ sigma: 1.0 })
            .normalize()
            .toFormat('png')
            .toFile(tmpOutput);
        workingPath = tmpOutput;
        cleanupTmp = true;
    } catch (err) {
        logger.warn(`[OCR CLI] No se pudo preprocesar ${imagePath}: ${err.message}. Se usa la imagen original.`);
    }

    const args = [
        workingPath,
        'stdout',
        '-l', lang,
        '--psm', numbersOnly ? '7' : (options.psm || '6'),
        '--oem', '1'
    ];

    if (numbersOnly) {
        args.push('-c', 'tessedit_char_whitelist=0123456789');
    }

    if (Array.isArray(options.extraConfigs)) {
        for (const entry of options.extraConfigs) {
            if (typeof entry === 'string') {
                args.push('-c', entry);
            }
        }
    }

    const timeout = options.timeoutMs || parseInt(process.env.TESSERACT_TIMEOUT_MS || '120000', 10);
    const start = process.hrtime();
    let text = '';

    try {
        const { stdout } = await execa('tesseract', args, { timeout });
        text = stdout;
    } catch (err) {
        logger.error(`[OCR CLI] Error ejecutando Tesseract: ${err.message}`);
        if (err.stdout) {
            text = err.stdout;
        }
        throw err;
    } finally {
        const diff = process.hrtime(start);
        const seconds = diff[0] + diff[1] / 1e9;
        try {
            ocrCliDuration.observe({ lang, mode: 'full' }, seconds);
        } catch (metricErr) {
            logger.debug(`[METRICS] No se pudo registrar duración OCR: ${metricErr.message}`);
        }
        if (cleanupTmp) {
            try {
                if (fs.existsSync(tmpOutput)) {
                    fs.unlinkSync(tmpOutput);
                }
            } catch (cleanupErr) {
                logger.warn(`[OCR CLI] No se pudo eliminar temporal ${tmpOutput}: ${cleanupErr.message}`);
            }
        }
    }

    const payload = {
        text: text || '',
        confidence: null,
        imageTooSmall,
        width: metadata ? metadata.width : null,
        height: metadata ? metadata.height : null,
        angle,
        lang,
        numbersOnly,
        ts: Date.now()
    };

    if (useCache) {
        cacheOcrResult(cacheImagePath, lang, numbersOnly, angle, payload);
    }

    return { ...payload, cacheHit: false };
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

// Procesa una página con OCR completo una sola vez por página
// lang debe ser 'spa' o 'eng' según input
// quickOcrResult: resultado opcional de quick-OCR para reutilización
// preprocessResult: resultado de preprocesado compartido (sin rotación)
async function processPageWithOcr(imagePath, lang = "spa", quickOcrResult = null, preprocessResult = null) {
    const { hasValidOrientation } = require('./parser');

    if (quickOcrResult && quickOcrResult.text && quickOcrResult.text.length > 0) {
        if (hasValidOrientation(quickOcrResult.text, lang)) {
            logger.info(`[OCR CACHE] Reutilizando resultado quick-OCR válido para ${imagePath}`);
            return { ...quickOcrResult, cacheHit: quickOcrResult.cacheHit || false };
        }
        logger.info(`[OCR CACHE] Quick-OCR no validó keywords, se ejecutará OCR completo.`);
    }

    const candidateAngles = [];
    const seenAngles = new Set();
    const registerAngle = (value) => {
        if (typeof value !== 'number' || Number.isNaN(value)) return;
        const normalized = ((value % 360) + 360) % 360;
        const allowed = [0, 90, 180, 270];
        const candidate = allowed.includes(normalized) ? normalized : value;
        if (!seenAngles.has(candidate)) {
            seenAngles.add(candidate);
            candidateAngles.push(candidate);
        }
    };

    if (quickOcrResult && typeof quickOcrResult.angle === 'number') {
        registerAngle(quickOcrResult.angle);
    }

    const osdAngle = await detectOrientationWithOSD(imagePath);
    if (typeof osdAngle === 'number') {
        registerAngle(osdAngle);
    }

    registerAngle(0);
    registerAngle(90);
    registerAngle(180);
    registerAngle(270);

    const resultsByAngle = new Map();

    const getOrRunOcrForAngle = async (angle) => {
        if (resultsByAngle.has(angle)) {
            return resultsByAngle.get(angle);
        }

        const cached = getCachedOcrResult(imagePath, lang, angle, false);
        if (cached && cached.text) {
            const normalizedCached = { ...cached, angle, osd: angle === osdAngle, cacheHit: true };
            resultsByAngle.set(angle, normalizedCached);
            return normalizedCached;
        }

        let rotatedPath = imagePath;
        let createdRotated = false;

        if (angle && angle !== 0) {
            try {
                rotatedPath = await rotateImage(imagePath, angle);
                createdRotated = rotatedPath !== imagePath;
            } catch (err) {
                logger.warn(`[OCR] No se pudo rotar ${imagePath} a ${angle}°: ${err.message}`);
                rotatedPath = imagePath;
                createdRotated = false;
            }
        }

        let ocrResult = null;
        try {
            ocrResult = await applyOcrToImage(rotatedPath, lang, false, {
                angle,
                cacheKeyImagePath: imagePath
            });
        } finally {
            if (createdRotated && rotatedPath && rotatedPath !== imagePath) {
                try {
                    if (fs.existsSync(rotatedPath)) {
                        fs.unlinkSync(rotatedPath);
                    }
                } catch (cleanupErr) {
                    logger.warn(`[CLEANUP] Error eliminando ${rotatedPath}: ${cleanupErr.message}`);
                }
            }
        }

        const normalized = ocrResult ? { ...ocrResult, angle, osd: angle === osdAngle } : null;
        if (normalized) {
            resultsByAngle.set(angle, normalized);
        }
        return normalized;
    };

    let firstResult = null;
    for (const angle of candidateAngles) {
        const result = await getOrRunOcrForAngle(angle);
        if (!result || !result.text) {
            continue;
        }

        if (!firstResult) {
            firstResult = result;
        }

        if (hasValidOrientation(result.text, lang)) {
            if (result.cacheHit) {
                logger.info(`[OCR CACHE] Cache válido encontrado para ${imagePath} a ${angle}°`);
            } else {
                logger.info(`[OCR] OCR válido obtenido para ${imagePath} a ${angle}°`);
            }
            return result;
        }
    }

    if (firstResult) {
        return firstResult;
    }

    if (quickOcrResult && quickOcrResult.text) {
        return { ...quickOcrResult, cacheHit: quickOcrResult.cacheHit || false };
    }

    return null;
}

module.exports = {
    applyOcrToImage,
    rotateImage,
    processPageWithOcr,
    detectOrientationWithOSD,
    getCachedOcrResult
};

