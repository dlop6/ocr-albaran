
const { applyOcrToImage } = require('./ocrService');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');


/**
 * Extrae campos clave de una página OCR y devuelve objeto estructurado
 * @param {string} text - Texto OCR de la página
 * @param {number} pag - Número de página (1-based)
 * @returns {object} Objeto con los campos extraídos y estado de error
 */
function extractFieldsFromText(text, pag) {
    // DEBUG: Log del texto OCR para análisis
    console.log(`=== DEBUG PÁGINA ${pag} ===`);
    console.log('Texto OCR completo:');
    console.log(text);
    console.log('=== FIN DEBUG ===');
    
    // Patrones robustos para cada campo 
    const patterns = {
        numeroOrden: [
            /P\.O[:\s]*(\d{8,12})/i,
            /P\.O\.[:\s]*(\d{8,12})/i,
            /PO[:\s-]*(\d{8,12})/i,
            /p[\s\.]?o[\s\.]?[:\s-]*(\d{8,12})/i,
            /(?:purchase\s*order|order)[:\s-]*(\d{8,12})/i,
            /n[úu]m\.?\s*orden[:\s-]*(\d{8,12})/i,
            /(?:^|\s)(\d{10})(?:\s|$)/
        ],
        numeroRecibo: [
            /receiver\s*[#:$E]?\s*[:$#E-]?\s*(\d{6,12})/i,
            /receiver\s*[#:$E]?\s*[:$#E-]?\s*(\d{2}-\d{8})/i,
            /recibo[\s;:]*(\d{2}-\d{8})/i,
            /recibo[\s;:]*(\d{8,12})/i,
            /receipt[\s#:\-;]*(\d{2}-\d{8})/i,
            /receipt[\s#:\-;]*(\d{8,12})/i
        ],
        departamento: [
            /dpto[:\s]*(\d{2,3})/i,
            /dept(?:o|o\.)?[:\s-]*(\d{2,3})/i,
            /departamento[:\s-]*(\d{2,3})/i,
            /department[:\s-]*(\d{2,3})/i
        ],
        total: [
            /(?:total|importe\s*total|amount)[^\d]*(\d{1,6}[.,]\d{2})/i,
            /(?:total|amount)[^\d]*(\d{1,6})/i,
            /total[^\d]*(\d{1,6}(?:[.,]\d{2})?)/i
        ]
    };
    
    
    let totalEncontrado = false;
    const lineas = text.split(/\r?\n/);
    for (const linea of lineas) {
        if (/total/i.test(linea)) {
            // Buscar todos los números decimales en la línea
            const matches = Array.from(linea.matchAll(/(\d{1,6}[.,]\d{2})/g)).map(m => parseFloat(m[1].replace(/,/g, ".")));
            const mayores = matches.filter(n => n > 0.01);
            if (mayores.length > 0) {
                // Tomar el mayor o el último (usualmente el total está al final)
                total = mayores[mayores.length - 1];
                totalEncontrado = true;
                break;
            }
        }
    }
    // Si no se encontró en línea con TOTAL, usar patrones globales
    if (!totalEncontrado) {
        for (const regex of patterns.total) {
            const match = text.match(regex);
            if (match && match[1]) {
                let val = match[1].replace(/[^\d.,]/g, "");
                val = val.replace(/,/g, "").replace(/\.(?=\d{3,})/, "");
                total = parseFloat(val.replace(/,/g, "."));
                totalEncontrado = true;
                break;
            }
        }
    }
    // Si aún no se encontró, buscar todos los valores decimales y tomar el mayor >0
    if (!totalEncontrado || !total || isNaN(total)) {
        const allMatches = Array.from(text.matchAll(/(\d{1,6}[.,]\d{2})/g)).map(m => parseFloat(m[1].replace(/,/g, ".")));
        const mayores = allMatches.filter(n => n > 0.01);
        if (mayores.length > 0) {
            total = Math.max(...mayores);
        } else {
            total = 0;
            statusError = true;
            mensajes.push("No se encontró Total");
        }
    }
    if (!numeroOrden) {
        statusError = true;
        mensajes.push("No se encontró PO Number");
    }

    // Número de recibo (receiver)
    for (const regex of patterns.numeroRecibo) {
        const match = text.match(regex);
        if (match && match[1]) {
            numeroRecibo = match[1].trim();
            break;
        }
    }
    // Si no se encontró, buscar número cerca de la palabra Receiver en la línea
    if (!numeroRecibo) {
        const receiverLine = (text.split('\n').find(l => /receiver/i.test(l)) || "");
        const numMatch = receiverLine.match(/(\d{6,12})/);
        if (numMatch) {
            numeroRecibo = numMatch[1];
        }
    }
    if (!numeroRecibo) {
        statusError = true;
        mensajes.push("No se encontró Receiver");
    }

    // Departamento: tolerar variantes como Dept — 95, Dept—95, Dept 95, Dept: 95, Dept - 95
    // Permitir errores de OCR: espacios, guiones normales o largos, dos puntos, y variantes de separación
    const departamentoRegexRobusto = /(?:Dept\s*[—\-:;,.]?\s*|Departamento\s*[—\-:;,.]?\s*)(\d{1,4})/i;
    let departamentoMatch = text.match(departamentoRegexRobusto);
    if (!departamentoMatch) {
        // fallback: buscar solo "Dept" seguido de cualquier separador y número
        departamentoMatch = text.match(/Dept\s*[—\-:;,.]?\s*(\d{1,4})/i);
    }
    if (departamentoMatch) {
        departamento = departamentoMatch[1].trim();
    } else {
        // fallback: patrones originales
        for (const regex of patterns.departamento) {
            const match = text.match(regex);
            if (match && match[1]) {
                departamento = match[1].trim();
                break;
            }
        }
        if (!departamento) {
            statusError = true;
            mensajes.push("No se encontró Departamento");
        }
    }

    // Total
    for (const regex of patterns.total) {
        const match = text.match(regex);
        if (match && match[1]) {
            let val = match[1].replace(/[^\d.,]/g, "");
            val = val.replace(/,/g, "").replace(/\.(?=\d{3,})/, "");
            total = parseFloat(val.replace(/,/g, "."));
            break;
        }
    }
    // Si no se encontró total explícito, buscar todos los valores decimales y tomar el mayor >0
    if (!total || isNaN(total)) {
        const allMatches = Array.from(text.matchAll(/(\d{1,6}[.,]\d{2})/g)).map(m => parseFloat(m[1].replace(/,/g, ".")));
        const mayores = allMatches.filter(n => n > 0.01); // evitar 0.00
        if (mayores.length > 0) {
            total = Math.max(...mayores);
        } else {
            total = 0;
            statusError = true;
            mensajes.push("No se encontró Total");
        }
    }

    return {
        pag,
        departamento,
        numeroOrden,
        numeroRecibo,
        total,
        statusError,
        mensaje: mensajes.join("|")
    };
}

module.exports = {
    extractFieldsFromText
};