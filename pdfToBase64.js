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
    // Ya no se guarda el base64 en ningún archivo
    return base64;
}

// Ruta al PDF a convertir (modifica aquí la ruta)
const pdfPath = "docs/albaran ingles.pdf";

try {
    const base64 = pdfToBase64File(pdfPath);
    console.log("Base64 generado (no guardado en archivo)");
} catch (err) {
    console.error("Error:", err.message);
}
