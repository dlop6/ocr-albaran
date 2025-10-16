const sharp = require('sharp');

/**
 * Detecta si una imagen es casi blanca (>percentWhite% de píxeles > threshold)
 * @param {string} imagePath - Ruta de la imagen
 * @param {number} threshold - Valor de gris para considerar "blanco" (default 240)
 * @param {number} percentWhite - Porcentaje para considerar "casi blanca" (default 98)
 * @returns {Promise<boolean>} true si la imagen es casi blanca
 */
async function isImageBlank(imagePath, threshold = 230, percentWhite = 93) {
  const img = await sharp(imagePath).greyscale().raw().toBuffer({ resolveWithObject: true });
  const totalPixels = img.info.width * img.info.height;
  let whitePixels = 0;
  for (let i = 0; i < img.data.length; i++) {
    if (img.data[i] > threshold) whitePixels++;
  }
  return (whitePixels / totalPixels) * 100 > percentWhite;
}

module.exports = isImageBlank;
