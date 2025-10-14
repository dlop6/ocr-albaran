const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');
const execa = require('execa');
const sharp = require('sharp');
const logger = require('../logger');

async function extractSinglePagePdf(sourcePdfPath, pageIndex, outPdfPath) {
  const bytes = fs.readFileSync(sourcePdfPath);
  const pdf = await PDFDocument.load(bytes);
  const newPdf = await PDFDocument.create();
  const [copied] = await newPdf.copyPages(pdf, [pageIndex]);
  newPdf.addPage(copied);
  const outBytes = await newPdf.save();
  fs.writeFileSync(outPdfPath, outBytes);
}

async function pdfToPng(pdfPath, outputDir) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outBase = path.join(outputDir, 'page');
  try {
    await execa('pdftocairo', ['-png', '-r', '300', pdfPath, outBase]);
    const files = fs.readdirSync(outputDir).filter(f => f.toLowerCase().endsWith('.png'));
    if (files.length === 0) throw new Error('No PNG produced');
    return path.join(outputDir, files[0]);
  } catch (err) {
    logger.warn('pdftocairo failed, using sharp fallback: ' + err.message);
    const outPng = path.join(outputDir, 'page.png');
    await sharp(pdfPath, { density: 300 }).png().toFile(outPng);
    return outPng;
  }
}

async function preprocImage(inputPath, outPath) {
  // Grayscale, normalize, sharpen and threshold to improve OCR
  await sharp(inputPath)
    .grayscale()
    .normalise()
    .sharpen({ sigma: 1.0 })
    .threshold(180)
    .toFile(outPath);
  return outPath;
}

async function runTesseract(imagePath, lang = 'spa', extraArgs = []) {
  const start = process.hrtime();
  const args = [imagePath, 'stdout', '--psm', '6', '-l', lang, ...extraArgs];
  const { stdout } = await execa('tesseract', args, { env: { ...process.env, OMP_NUM_THREADS: '1' } });
  const elapsed = process.hrtime(start);
  const seconds = elapsed[0] + elapsed[1] / 1e9;
  return { text: stdout, seconds };
}

function findFieldCandidates(texts, lang = 'spa') {
  const joined = texts.join('\n');
  const result = { po: null, recibo: null, dept: null, matches: {} };

  // Patterns (adaptive to Spanish)
  const poPatterns = [
    /P\.?\s*O\.?[:\s-]*([0-9]{6,20})/i,
    /P\.O\.[:\s-]*([0-9]{6,20})/i,
    /\b(\d{8,12})\b/ // fallback: long digit sequence
  ];
  const reciboPatterns = [
    /Recibo[:\s-]*([0-9\-]{6,20})/i,
    /Rec\.?[:\s-]*([0-9\-]{6,20})/i
  ];
  const deptPatterns = [
    /Dpto[:\s-]*([0-9]{1,4})/i,
    /Dept[:\s-]*([0-9]{1,4})/i,
    /Div[:\s-]*([0-9]{1,4})/i
  ];

  for (const p of poPatterns) {
    const m = joined.match(p);
    if (m && m[1]) { result.po = m[1].replace(/\D/g, ''); result.matches.po = m[0]; break; }
  }
  for (const p of reciboPatterns) {
    const m = joined.match(p);
    if (m && m[1]) { result.recibo = m[1].replace(/[^0-9\-]/g, ''); result.matches.recibo = m[0]; break; }
  }
  for (const p of deptPatterns) {
    const m = joined.match(p);
    if (m && m[1]) { result.dept = m[1].replace(/\D/g, ''); result.matches.dept = m[0]; break; }
  }

  return result;
}

async function extractFieldsFromPage({ pdfPath, pageIndex = 14, lang = 'spa' }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-fields-'));
  const singlePdf = path.join(tmpDir, 'page.pdf');
  await extractSinglePagePdf(pdfPath, pageIndex, singlePdf);
  const png = await pdfToPng(singlePdf, tmpDir);

  // raw OCR
  let raw = { error: null };
  try { raw = await runTesseract(png, lang); } catch (e) { raw = { error: e.message }; }

  // preprocessed OCR
  const preprocPath = path.join(tmpDir, 'page_preproc.png');
  await preprocImage(png, preprocPath);
  let pre = { error: null };
  try { pre = await runTesseract(preprocPath, lang); } catch (e) { pre = { error: e.message }; }

  // numbers-only OCR on preproc
  let nums = { error: null };
  try { nums = await runTesseract(preprocPath, lang, ['-c', "tessedit_char_whitelist=0123456789-."]); } catch (e) { nums = { error: e.message }; }

  // Prefer numbers OCR for numeric fields, but fallback to raw/pre
  const texts = [];
  if (nums && nums.text) texts.push(nums.text);
  if (pre && pre.text) texts.push(pre.text);
  if (raw && raw.text) texts.push(raw.text);

  const candidates = findFieldCandidates(texts, lang);

  const out = {
    png,
    tmpDir,
    raw,
    pre,
    nums,
    extracted: candidates
  };
  return out;
}

async function cli() {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const srcPdf = path.join(projectRoot, 'docs', 'EJEMPLO 3.pdf');
  if (!fs.existsSync(srcPdf)) {
    console.error('PDF not found:', srcPdf);
    process.exit(1);
  }
  const res = await extractFieldsFromPage({ pdfPath: srcPdf, pageIndex: 14, lang: 'spa' });
  const outFile = path.join(projectRoot, 'src', 'utils', 'ocr_extracted_fields.json');
  fs.writeFileSync(outFile, JSON.stringify(res, null, 2));
  console.log('Extraction written to', outFile);
}

if (require.main === module) {
  cli().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { extractFieldsFromPage };
