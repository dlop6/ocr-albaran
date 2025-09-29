const fs = require("fs");
const path = require("path");

/**
 * Convierte un PDF a base64 y lo guarda en un archivo .txt temporal
 * @param {string} pdfPath - Ruta al archivo PDF
 * @returns {string} - Ruta al archivo .txt generado
 */
function pdfToBase64File(pdfPath) {
    if (!fs.existsSync(pdfPath)) {
        throw new Error("El archivo PDF no existe: " + pdfPath);
    }
    const pdfBuffer = fs.readFileSync(pdfPath);
    const base64 = pdfBuffer.toString("base64");
    const txtPath = path.join(__dirname, "temp_pdf_base64.txt");
    fs.writeFileSync(txtPath, base64);
    return txtPath;
}

// Ruta al PDF a convertir (modifica aquí la ruta)
const pdfPath = "docs/EJEMPLO 5.pdf";

try {
    const txtPath = pdfToBase64File(pdfPath);
    console.log("Base64 guardado en:", txtPath);
} catch (err) {
    console.error("Error:", err.message);
}
