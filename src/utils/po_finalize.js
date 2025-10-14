const fs = require('fs');
const path = require('path');

function findDigitCandidates(text) {
  if (!text) return [];
  const matches = text.match(/\d{6,20}/g) || [];
  // normalize remove non digits
  return matches.map(m => m.replace(/[^0-9]/g, ''));
}

function scoreCandidates(cands) {
  const map = {};
  for (const c of cands) {
    // prefer 8-12 digits (typical PO lengths) but keep others
    if (!c) continue;
    map[c] = (map[c] || 0) + 1;
  }
  return map;
}

function pickBest(map) {
  const keys = Object.keys(map);
  if (keys.length === 0) return null;
  // sort by votes then by closeness to 10 digits then by length
  keys.sort((a,b) => {
    const scoreA = map[a];
    const scoreB = map[b];
    if (scoreB !== scoreA) return scoreB - scoreA;
    const prefA = Math.abs(a.length - 10);
    const prefB = Math.abs(b.length - 10);
    if (prefA !== prefB) return prefA - prefB;
    return b.length - a.length;
  });
  return keys[0];
}

function main() {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const retryPath = path.join(projectRoot, 'src', 'utils', 'ocr_po_retry.json');
  if (!fs.existsSync(retryPath)) {
    console.error('No retry file found'); process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(retryPath, 'utf8'));
  const candidates = [];
  // from attemptResult text
  if (data.attemptResult) {
    if (data.attemptResult.text) candidates.push(...findDigitCandidates(data.attemptResult.text));
    if (data.attemptResult.source) candidates.push(...findDigitCandidates(data.attemptResult.source));
    if (data.attemptResult.sourceText) candidates.push(...findDigitCandidates(data.attemptResult.sourceText));
    if (data.attemptResult.sourceConcat) candidates.push(...findDigitCandidates(data.attemptResult.sourceConcat));
    if (Array.isArray(data.attemptResult.ensembleResults)) {
      for (const e of data.attemptResult.ensembleResults) {
        if (e.text) candidates.push(...findDigitCandidates(e.text));
      }
    }
  }
  // also scan tsvRowsSample texts
  if (Array.isArray(data.tsvRowsSample)) {
    for (const r of data.tsvRowsSample) if (r.text) candidates.push(...findDigitCandidates(r.text));
  }

  // normalize candidates to remove leading zeros long stretches
  const normalized = candidates.map(c => c.replace(/^0+/, '') || c);
  const scored = scoreCandidates(normalized);
  const best = pickBest(scored);
  const out = { candidates: normalized, votes: scored, best };
  const outPath = path.join(projectRoot, 'src', 'utils', 'ocr_po_final.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('Wrote', outPath);
}

if (require.main === module) main();
