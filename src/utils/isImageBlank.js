const sharp = require('sharp');

/**
 * Calcula si una imagen (o el resultado de su preprocesamiento) es prácticamente blanca.
 * Se apoya en histogramas estadísticos de sharp() para evitar traer todos los píxeles a JS.
 *
 * @param {string|Buffer|object} source - Ruta, buffer o resultado de preprocessImage().
 * @param {number|object} [thresholdOrOptions] - Umbral de gris (0-255) o un objeto de opciones.
 * @param {number} [percentWhite=97] - Porcentaje mínimo de píxeles sobre el umbral para considerar en blanco.
 * @returns {Promise<boolean>}
 */
async function isImageBlank(source, thresholdOrOptions, percentWhite = 97) {
  let threshold = 245;
  let statsOverride = null;

  if (typeof thresholdOrOptions === 'object' && thresholdOrOptions !== null) {
    const opts = thresholdOrOptions;
    if (typeof opts.threshold === 'number') threshold = opts.threshold;
    if (typeof opts.percentWhite === 'number') percentWhite = opts.percentWhite;
    if (opts.stats) statsOverride = opts.stats;
  } else if (typeof thresholdOrOptions === 'number') {
    threshold = thresholdOrOptions;
  }

  const { stats, thresholdUsed } = await resolveStats(source, threshold, statsOverride);
  const histogram = stats?.channels?.[0]?.histogram || [];
  if (!histogram.length) {
    return false;
  }

  const totalPixels = histogram.reduce((sum, value) => sum + value, 0);
  if (!totalPixels) {
    return false;
  }

  const cutoff = Math.max(0, Math.min(histogram.length - 1, Math.floor(thresholdUsed)));
  let whitePixels = 0;
  for (let i = cutoff; i < histogram.length; i++) {
    whitePixels += histogram[i];
  }

  const whitePercent = (whitePixels / totalPixels) * 100;
  return whitePercent >= percentWhite;
}

async function resolveStats(source, threshold, statsOverride) {
  if (statsOverride) {
    return { stats: statsOverride, thresholdUsed: threshold };
  }

  if (source && typeof source === 'object') {
    // Resultado del preprocesamiento compartido
    if (source.binarized && source.binarized.stats && source.binarized.threshold === threshold) {
      return { stats: source.binarized.stats, thresholdUsed: source.binarized.threshold };
    }
    if (source.binarized && source.binarized.stats && source.binarized.threshold !== undefined) {
      // Si el umbral solicitado difiere del precalculado, recomputar desde el buffer procesado
      if (source.processed && source.processed.buffer) {
        const stats = await sharp(source.processed.buffer)
          .threshold(threshold)
          .stats();
        return { stats, thresholdUsed: threshold };
      }
    }
    if (source.binarized && source.binarized.buffer) {
      const stats = await sharp(source.binarized.buffer).stats();
      const used = source.binarized.threshold ?? threshold;
      return { stats, thresholdUsed: used };
    }
    if (source.processed && source.processed.buffer) {
      const stats = await sharp(source.processed.buffer)
        .threshold(threshold)
        .stats();
      return { stats, thresholdUsed: threshold };
    }
  }

  if (typeof source === 'string') {
    const stats = await sharp(source)
      .greyscale()
      .threshold(threshold)
      .stats();
    return { stats, thresholdUsed: threshold };
  }

  if (Buffer.isBuffer(source)) {
    const stats = await sharp(source)
      .greyscale()
      .threshold(threshold)
      .stats();
    return { stats, thresholdUsed: threshold };
  }

  throw new Error('Unsupported source provided to isImageBlank');
}

module.exports = isImageBlank;
