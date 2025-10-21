const fs = require('fs');
const fetch = require('node-fetch');

(async () => {
  try {
    const filePath = 'docs/EJEMPLO 7.pdf';
    if (!fs.existsSync(filePath)) {
      console.error('File not found:', filePath);
      process.exit(2);
    }

    const b64 = fs.readFileSync(filePath).toString('base64');
    const payload = { pdfBase64: b64 };

    console.log('Sending request to http://localhost:3000/api/process-pdf ...');
    const res = await fetch('http://localhost:3000/api/process-pdf', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
      timeout: 600000
    });

    console.log('Status:', res.status);
    const json = await res.json();
    fs.writeFileSync('temp_results/smoke_ejemplo7_result.json', JSON.stringify(json, null, 2));
    console.log('Saved result to temp_results/smoke_ejemplo7_result.json');

    // Check pages kept
    const pages = json.pages || json.pagesProcessed || [];
    console.log('pages length (raw):', pages.length);

    // Heurística simple: buscar referencia a "EJEMPLO 7" en text o existencia de page 18/20
    const kept = pages.filter(p => p && p.text && p.text.length > 20);
    console.log('pages with substantial text:', kept.length);

    // Save basic summary
    fs.writeFileSync('temp_results/smoke_ejemplo7_summary.json', JSON.stringify({status: res.status, pagesRaw: pages.length, pagesWithText: kept.length}, null, 2));

    process.exit(0);
  } catch (err) {
    console.error('Error running smoke test:', err.message);
    process.exit(1);
  }
})();
