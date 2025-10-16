const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const DEFAULTS = {
  downscaleMaxDim: 1000, // speed-up processing for bbox detection
  binarizeThreshold: 200, // 0-255
  minAreaPercent: 0.5, // percent of page area
  paddingPercent: 5, // percent padding around bbox
  targetWidthPx: 2000,
  maxScale: 4.0,
};

// simple flood-fill connected components on a binary image
function findLargestComponent(binary, width, height) {
  const visited = new Uint8Array(binary.length);
  let best = { area: 0, bbox: null };

  const idx = (x, y) => y * width + x;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y);
      if (binary[i] === 0 || visited[i]) continue;
      // flood fill
      let minX = x, maxX = x, minY = y, maxY = y;
      let area = 0;
      const stack = [i];
      visited[i] = 1;
      while (stack.length) {
        const cur = stack.pop();
        const cx = cur % width;
        const cy = Math.floor(cur / width);
        area++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        // neighbors 4-connectivity
        if (cx > 0) {
          const ni = idx(cx - 1, cy);
          if (!visited[ni] && binary[ni]) { visited[ni] = 1; stack.push(ni); }
        }
        if (cx < width - 1) {
          const ni = idx(cx + 1, cy);
          if (!visited[ni] && binary[ni]) { visited[ni] = 1; stack.push(ni); }
        }
        if (cy > 0) {
          const ni = idx(cx, cy - 1);
          if (!visited[ni] && binary[ni]) { visited[ni] = 1; stack.push(ni); }
        }
        if (cy < height - 1) {
          const ni = idx(cx, cy + 1);
          if (!visited[ni] && binary[ni]) { visited[ni] = 1; stack.push(ni); }
        }
      }

      if (area > best.area) best = { area, bbox: { minX, minY, maxX, maxY } };
    }
  }

  return best;
}

async function detectContentBBox(imagePath, opts = {}) {
  const options = { ...DEFAULTS, ...opts };
  const image = sharp(imagePath);
  const meta = await image.metadata();
  const origW = meta.width;
  const origH = meta.height;

  const scale = Math.min(1, options.downscaleMaxDim / Math.max(origW, origH));
  const smallW = Math.max(1, Math.round(origW * scale));
  const smallH = Math.max(1, Math.round(origH * scale));

  const raw = await image
    .resize(smallW, smallH)
    .greyscale()
    .raw()
    .toBuffer();

  // threshold to binary
  const binary = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    binary[i] = raw[i] < options.binarizeThreshold ? 1 : 0; // ink=1
  }

  const comp = findLargestComponent(binary, smallW, smallH);
  if (!comp.bbox) return { bbox: null };

  const compArea = comp.area;
  const pageArea = smallW * smallH;
  const compPct = (compArea / pageArea) * 100;

  if (compPct < options.minAreaPercent) {
    return { bbox: null }; // too small
  }

  // scale bbox back to original size
  const { minX, minY, maxX, maxY } = comp.bbox;
  const scaleBack = 1 / scale;
  const bbox = {
    left: Math.max(0, Math.floor(minX * scaleBack)),
    top: Math.max(0, Math.floor(minY * scaleBack)),
    width: Math.min(origW, Math.ceil((maxX - minX + 1) * scaleBack)),
    height: Math.min(origH, Math.ceil((maxY - minY + 1) * scaleBack)),
  };

  // apply padding
  const padX = Math.round((options.paddingPercent / 100) * bbox.width);
  const padY = Math.round((options.paddingPercent / 100) * bbox.height);
  bbox.left = Math.max(0, bbox.left - padX);
  bbox.top = Math.max(0, bbox.top - padY);
  bbox.width = Math.min(origW - bbox.left, bbox.width + padX * 2);
  bbox.height = Math.min(origH - bbox.top, bbox.height + padY * 2);

  // compute scale factor to reach targetWidthPx
  const scaleFactor = Math.min(options.maxScale, Math.max(1, options.targetWidthPx / bbox.width));

  return { bbox, scaleFactor, compPct };
}

async function cropAndNormalize(imagePath, bbox, opts = {}) {
  const options = { ...DEFAULTS, ...opts };
  const tmpDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const outPath = path.join(tmpDir, `crop_${Date.now()}.png`);

  const metadata = await sharp(imagePath).metadata();
  const targetW = Math.round(bbox.width * (opts.scaleFactor || 1));
  const targetH = Math.round(bbox.height * (opts.scaleFactor || 1));

  await sharp(imagePath)
    .extract({ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height })
    .resize(targetW, targetH, { kernel: sharp.kernel.lanczos3 })
    .flatten({ background: '#ffffff' })
    .toFile(outPath);

  return outPath;
}

module.exports = {
  detectContentBBox,
  cropAndNormalize,
  DEFAULTS,
};
