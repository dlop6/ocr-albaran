const fs = require('fs');
const path = require('path');
const execa = require('execa');
const sharp = require('sharp');

function parseTsv(tsv) {
  const lines = tsv.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split('\t');
  const rows = lines.slice(1).map(l => {
    const cols = l.split('\t');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i]; });
    return obj;
  });
  return rows;
}

function expandBox(bbox, imgW, imgH, pad=30) {
  const left = Math.max(0, parseInt(bbox.left,10) - pad);
  const top = Math.max(0, parseInt(bbox.top,10) - pad);
  const right = Math.min(imgW, parseInt(bbox.left,10) + parseInt(bbox.width,10) + pad);
  const bottom = Math.min(imgH, parseInt(bbox.top,10) + parseInt(bbox.height,10) + pad);
  return { left, top, width: right - left, height: bottom - top };
}

async function tryRecoverPo(png, lang = 'spa', options = {}) {
  if (!png || !fs.existsSync(png)) {
    return { success: false, error: 'PNG not found' };
  }
  // 1) get TSV from tesseract
  let rows = [];
  try {
    const tsvRes = await execa('tesseract', [png, 'stdout', '--psm', '6', '-l', lang, 'tsv'], { env: { ...process.env, OMP_NUM_THREADS: options.threads || '1' } });
    rows = parseTsv(tsvRes.stdout);
  } catch (err) {
    return { success: false, error: `tsv-failed: ${err.message}` };
  }

  // find token matching PO variants
  const poToken = rows.find(r => {
    const text = (r.text||'').trim();
    if (!text) return false;
    return /^(P\.?\s*O\.?|PO|P O)$/i.test(text);
  });

  const imgMeta = await sharp(png).metadata();
  let cropPath = null;
  let attemptResult = null;

  if (poToken) {
    const box = expandBox(poToken, imgMeta.width, imgMeta.height, 60);
    cropPath = path.join(path.dirname(png), 'po_crop.png');
    await sharp(png).extract(box).toFile(cropPath);
    // run tesseract on crop with numeric whitelist
    try {
      const res = await execa('tesseract', [cropPath, 'stdout', '--psm', '7', '-l', lang, '-c', 'tessedit_char_whitelist=0123456789'], { env: { ...process.env, OMP_NUM_THREADS: options.threads || '1' } });
      attemptResult = { method: 'token-crop', text: res.stdout.trim() };
    } catch (e) {
      attemptResult = { method: 'token-crop', error: e.message };
    }
    // If token-crop produced empty text, try cropping the entire line (all tokens with same line_num)
    if ((!attemptResult || !attemptResult.text) && poToken && poToken.line_num) {
      const lineNum = poToken.line_num;
      const lineTokens = rows.filter(r => r.line_num === lineNum && r.text && r.text.trim());
      if (lineTokens.length > 0) {
        const left = Math.min(...lineTokens.map(t => parseInt(t.left||0,10)));
        const tops = lineTokens.map(t => parseInt(t.top||0,10));
        const top = Math.min(...tops);
        const rights = lineTokens.map(t => parseInt(t.left||0,10) + parseInt(t.width||0,10));
        const bottoms = lineTokens.map(t => parseInt(t.top||0,10) + parseInt(t.height||0,10));
        const right = Math.max(...rights);
        const bottom = Math.max(...bottoms);
        const width = Math.min(imgMeta.width, right - left + 120);
        const height = Math.min(imgMeta.height, bottom - top + 60);
        const cropLine = { left: Math.max(0, left - 60), top: Math.max(0, top - 20), width, height };
        const lineCropPath = path.join(path.dirname(png), 'po_line_crop.png');
        await sharp(png).extract(cropLine).toFile(lineCropPath);
        try {
          const r2 = await execa('tesseract', [lineCropPath, 'stdout', '--psm', '7', '-l', lang, '-c', 'tessedit_char_whitelist=0123456789'], { env: { ...process.env, OMP_NUM_THREADS: options.threads || '1' } });
          attemptResult = { method: 'line-crop', text: r2.stdout.trim(), source: lineTokens.map(t=>t.text).join(' ') };
          cropPath = lineCropPath;
        } catch (e) {
          attemptResult = { method: 'line-crop', error: e.message };
        }
        // If line-crop is empty or poor, run ensemble: multiple preprocess thresholds + psm 7/6
        if (!attemptResult || !attemptResult.text) {
          const ensembleResults = [];
          const thresholds = [150, 170, 190];
          const psms = ['7','6'];
          for (const thr of thresholds) {
            const thrPath = path.join(path.dirname(png), `po_line_thr_${thr}.png`);
            try {
              await sharp(png).extract(cropLine).grayscale().normalise().threshold(thr).toFile(thrPath);
            } catch (e) {
              // fallback: just copy
              await sharp(png).extract(cropLine).toFile(thrPath);
            }
            for (const psm of psms) {
              try {
                const r3 = await execa('tesseract', [thrPath, 'stdout', '--psm', psm, '-l', lang, '-c', 'tessedit_char_whitelist=0123456789-'], { env: { ...process.env, OMP_NUM_THREADS: options.threads || '1' } });
                const txt = (r3.stdout || '').trim();
                ensembleResults.push({ thr, psm, text: txt });
              } catch (e) {
                ensembleResults.push({ thr, psm, error: e.message });
              }
            }
          }
          // pick the best numeric candidate: longest sequence of digits (>=8), frequency count
          const candidates = {};
          for (const r of ensembleResults) {
            if (!r.text) continue;
            const matched = r.text.match(/(\d[\d\-\.]{6,20}\d)/g);
            if (!matched) continue;
            for (const m of matched) {
              const clean = m.replace(/[^0-9]/g,'');
              if (clean.length < 6) continue;
              candidates[clean] = (candidates[clean]||0) + 1;
            }
          }
          const sorted = Object.keys(candidates).sort((a,b)=> candidates[b]-candidates[a] || b.length - a.length);
          if (sorted.length > 0) {
            attemptResult = { method: 'ensemble-line', picks: sorted, votes: candidates, ensembleResults };
            cropPath = lineCropPath;
          } else {
            attemptResult = { method: 'ensemble-line', picks: [], ensembleResults };
          }
        }
      }
    }
  } else {
    // fallback: find longest numeric token that is not a date/recibo
    const candidates = rows
      .map(r => ({text: (r.text||'').trim(), left: r.left, top: r.top, width: r.width, height: r.height}))
      .filter(c => c.text && /[0-9]/.test(c.text))
      .map(c => ({...c, digits: c.text.replace(/[^0-9]/g,'')}))
      .filter(c => c.digits.length >= 6);
    // exclude dates like 08/18/25 or patterns with hyphens of small length
    const filtered = candidates.filter(c => !/^\d{2}[-\/\.]\d{2}[-\/\.]\d{2}$/.test(c.text));
    if (filtered.length === 0) {
      attemptResult = { method: 'no-candidates' };
    } else {
      // choose longest digits
      filtered.sort((a,b) => b.digits.length - a.digits.length);
      const best = filtered[0];
      const box = expandBox(best, imgMeta.width, imgMeta.height, 40);
      cropPath = path.join(path.dirname(png), 'po_fallback_crop.png');
      await sharp(png).extract(box).toFile(cropPath);
      try {
        const res = await execa('tesseract', [cropPath, 'stdout', '--psm', '7', '-l', lang, '-c', 'tessedit_char_whitelist=0123456789'], { env: { ...process.env, OMP_NUM_THREADS: options.threads || '1' } });
        attemptResult = { method: 'fallback-longnum', text: res.stdout.trim(), sourceText: best.text };
      } catch (e) {
        attemptResult = { method: 'fallback-longnum', error: e.message };
      }
    }
  }

  const out = { poTokenFound: !!poToken, cropPath, attemptResult, tsvRowsSample: rows.slice(0,10) };
  return { success: true, out };
}

// preserve CLI behavior for compatibility
async function run() {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const extractedPath = path.join(projectRoot, 'src', 'utils', 'ocr_extracted_fields.json');
  if (!fs.existsSync(extractedPath)) {
    console.error('Missing ocr_extracted_fields.json'); process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(extractedPath, 'utf8'));
  const png = data.png;
  if (!png || !fs.existsSync(png)) {
    console.error('PNG not found:', png); process.exit(1);
  }
  const res = await tryRecoverPo(png, 'spa');
  const outFile = path.join(path.dirname(extractedPath), 'ocr_po_retry.json');
  if (res.success) {
    fs.writeFileSync(outFile, JSON.stringify(res.out, null, 2));
    console.log('Wrote', outFile);
  } else {
    console.error('Recovery failed:', res.error);
  }
}

module.exports = { tryRecoverPo };

if (require.main === module) run().catch(err => { console.error(err); process.exit(1); });
