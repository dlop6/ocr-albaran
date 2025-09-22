const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const inputPdf = process.argv[2] || path.join(__dirname, 'temp.pdf');
const outputPdf = path.join(__dirname, 'temp_first_page.pdf');

(async () => {
    try {
        const pdfBytes = fs.readFileSync(inputPdf);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const newPdf = await PDFDocument.create();
        const copiedPages = await newPdf.copyPages(pdfDoc, [0]);
        console.log('copiedPages:', copiedPages);
        if (!copiedPages || copiedPages.length === 0) {
            throw new Error('No se pudo copiar la página 1 del PDF.');
        }
        const firstPage = copiedPages[0];
        console.log('Tipo de firstPage:', typeof firstPage, firstPage && firstPage.constructor && firstPage.constructor.name);
        newPdf.addPage(firstPage);
        const newPdfBytes = await newPdf.save();
        fs.writeFileSync(outputPdf, newPdfBytes);
        console.log(`Página 1 extraída y guardada en: ${outputPdf}`);
    } catch (err) {
        console.error('Error extrayendo la primera página:', err);
    }
})();
