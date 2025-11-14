const { applyOcrToImage } = require('./ocrService');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');


/**
 * Extrae campos clave de una página OCR y devuelve objeto estructurado
 * @param {string} text - Texto OCR de la página
 * @param {number} pag - Número de página (1-based)
 * @param {string} idioma - ISO 639 code: 'es' or 'en' (also accepts 'ESP','ING','spa','eng' for compatibility)
 * @returns {object} Objeto con los campos extraídos y estado de error
 */
function extractFieldsFromText(text, pag, idioma = 'es') {
    function normalizeLang(l) {
        if (!l) return 'es';
        const s = String(l).toLowerCase();
        if (['es', 'spa', 'esp', 'es-es'].includes(s)) return 'es';
        if (['en', 'eng', 'ing', 'en-us'].includes(s)) return 'en';
        return 'es';
    }
    const norm = normalizeLang(idioma);
    const isSpanish = norm === 'es';
    // Inicializar variables de salida
    let numeroOrden = "";
    let numeroRecibo = "";
    let departamento = "";
    let total = 0;
    let statusError = false;
    let mensajes = [];

    // Limpiar caracteres invisibles problemáticos (excepto saltos de línea)
    const cleanText = text.replace(/[\u200B-\u200D\uFEFF\u00A0\t\r]/g, ' ');

    // DEBUG: Log del texto OCR para análisis
    console.log(`=== DEBUG PÁGINA ${pag} ===`);
    console.log('Texto OCR completo:');
    console.log(text);
    console.log('=== FIN DEBUG ===');
    
    // Patrones robustos para cada campo, según idioma
    let patterns;
    let mensajesError = {
        numeroOrden: isSpanish ? 'No se encontró Número de Orden' : 'PO Number not found',
        numeroRecibo: isSpanish ? 'No se encontró Recibo' : 'Receiver not found',
        departamento: isSpanish ? 'No se encontró Departamento' : 'Department not found',
        total: isSpanish ? 'No se encontró Total' : 'Total not found'
    };
    if (isSpanish) {
        patterns = {
            numeroOrden: [
            /P\.O[:\s]*(\d{8,12})/i,
            /P\.O\.[:\s]*(\d{8,12})/i,
            /PO[:\s-]*(\d{8,12})/i,
            /p[\s\.]?o[\s\.]?[:\s-]*(\d{8,12})/i,
            /2[.,]0[:\s-]*(\d{8,12})/i, // OCR puede confundir 'P.O' con '2.0'
            /(?:^|\s)(\d{10})(?:\s|$)/
            ],
            numeroRecibo: [
            /recibo[\s;:]*(\d{2}-\d{8})/i,
            /recibo[\s;:]*(\d{8,12})/i
            ],
            departamento: [
            // Captura variantes: Dpto, Depto, Dept, Dpt, Beto, Bpto, etc. (errores OCR)
            /(?:[DB][ep][pt][o]?)[:\s—\-]*([0-9]{2,4})/i,
            /departamento[:\s—\-]*([0-9]{2,4})/i
            ],
            total: [
            /importe\s*total[^\d]*(\d{1,6}[.,]\d{2})/i,
            /total[^\d]*(\d{1,6}[.,]\d{2})/i
            ]
        };
    } else {
        patterns = {
            numeroOrden: [
                /PO\s*Number\s*[:\s-]*(\d{8,12})/i,  
                /P\.O[:\s]*(\d{8,12})/i,
                /P\.O\.[:\s]*(\d{8,12})/i,
                /PO[:\s-]*(\d{8,12})/i,
                /p[\s\.]?o[\s\.]?[:\s-]*(\d{8,12})/i,
                /2[.,]0[:\s-]*(\d{8,12})/i, // OCR puede confundir 'P.O' con '2.0'
                /(?:^|\s)(\d{10})(?:\s|$)/
            ],
            numeroRecibo: [
                /receiver\s*[#:$E]?\s*[:$#E-]?\s*(\d{6,12})/i,
                /receiver\s*[#:$E]?\s*[:$#E-]?\s*(\d{2}-\d{8})/i,
                /receipt[\s#:\-;]*(\d{2}-\d{8})/i,
                /receipt[\s#:\-;]*(\d{8,12})/i
            ],
            departamento: [
                // Captura variantes: Dept, Dpt, Beto, Bpto, etc. (errores OCR)
                /(?:[DB][ep][pt][o]?)[:\s—\-]*([0-9]{2,4})/i,
                /department[:\s—\-]*([0-9]{2,4})/i
            ],
            total: [
                /amount[^\d]*(\d{1,6}[.,]\d{2})/i,
                /total[^\d]*(\d{1,6}[.,]\d{2})/i
            ]
        };
    }
    
    
    if (isSpanish) {
        let totalEncontrado = false;
        const lineas = cleanText.split(/\r?\n/);
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
                const match = cleanText.match(regex);
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
            const allMatches = Array.from(cleanText.matchAll(/(\d{1,6}[.,]\d{2})/g)).map(m => parseFloat(m[1].replace(/,/g, ".")));
            const mayores = allMatches.filter(n => n > 0.01);
            if (mayores.length > 0) {
                total = Math.max(...mayores);
            } else {
                total = 0;
                statusError = true;
                mensajes.push(mensajesError.total);
            }
        }
    } else {
        // ING/en: no buscar ni reportar total
        total = 0;
    }

    // Número de orden
    for (const regex of patterns.numeroOrden) {
        const match = cleanText.match(regex);
        if (match && match[1]) {
            numeroOrden = match[1].trim();
            break;
        }
    }
    if (!numeroOrden) {
        statusError = true;
        mensajes.push(mensajesError.numeroOrden);
    }

    // Mejor extracción: buscar primero en la línea que contiene 'Receiver'
    const receiverLine = (cleanText.split('\n').find(l => /receiver/i.test(l)) || "");
    let receiverLineMatch = null;
    // Buscar después de 'Receiver' en la línea
    receiverLineMatch = receiverLine.match(/Receiver\s*[#:$E]?\s*[:$#E-]?\s*(\d{6,12})/i);
    if (receiverLineMatch && receiverLineMatch[1]) {
        numeroRecibo = receiverLineMatch[1].trim();
    }
    // Si no se encontró, buscar cualquier número de 6-12 dígitos después de 'Receiver' en la línea
    if (!numeroRecibo && /receiver/i.test(receiverLine)) {
        // Buscar todos los números en la línea después de 'Receiver'
        const afterReceiver = receiverLine.split(/receiver/i)[1] || "";
        const numMatch = afterReceiver.match(/(\d{6,12})/);
        if (numMatch) {
            numeroRecibo = numMatch[1];
        }
    }
    // Si aún no se encontró, usar patrones globales como fallback
    if (!numeroRecibo) {
        for (const regex of patterns.numeroRecibo) {
            const match = cleanText.match(regex);
            if (match && match[1]) {
                numeroRecibo = match[1].trim();
                break;
            }
        }
    }
    if (!numeroRecibo) {
        statusError = true;
        mensajes.push(mensajesError.numeroRecibo);
    }

    // Departamento: tolerar variantes como Dept — 95, Dept—95, Dept 95, Dept: 95, Dept - 95, Beto: 95, etc.
    const departamentoRegexRobusto = /(?:dept(?:o)?|dpto|depto|departamento|dpt|bpto|beto|d\s*e\s*p\s*t(?:o)?)[\s—\-:;,.]*([0-9]{1,4})/i;
    let departamentoMatch = cleanText.match(departamentoRegexRobusto);
    if (!departamentoMatch) {
        // fallback: buscar solo "Dept" (o variantes) seguido de cualquier separador y número
        departamentoMatch = cleanText.match(/(?:[DB][ep][pt][o]?)\s*[—\-:;,.]?\s*(\d{1,4})/i);
    }
    if (departamentoMatch) {
        departamento = departamentoMatch[1].trim();
    } else {
        // fallback: patrones originales
        for (const regex of patterns.departamento) {
            const match = cleanText.match(regex);
            if (match && match[1]) {
                departamento = match[1].trim();
                break;
            }
        }
        if (!departamento) {
            statusError = true;
            mensajes.push(mensajesError.departamento);
        }
    }

    // Solo incluir 'total' si idioma es español (ISO 'es')
    const result = {
        pag,
        departamento,
        numeroOrden,
        numeroRecibo,
        statusError,
        mensaje: mensajes.join("|")
    };
    if (isSpanish) {
        let totalNum = (typeof total === 'number' && !isNaN(total)) ? Number(total.toFixed(2)) : 0;
        result.total = totalNum;
    }
    return result;
}

module.exports = {
    extractFieldsFromText
};
