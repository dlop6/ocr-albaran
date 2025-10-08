const fs = require('fs');
const path = require('path');
const axios = require('axios');
const XLSX = require('xlsx');

// Configuración: mapea nombre de archivo a idioma
const pdfIdiomas = {
    'EJEMPLO 2.pdf': 'ING'
};

const DOCS_DIR = path.join(__dirname, 'docs');
const API_URL = 'http://167.86.69.136:3000/api/process-pdf'; // Cambia el puerto/IP si es necesario
const OUTPUT_XLSX = path.join(__dirname, 'informe_ocr_ejemplo2.xlsx');

async function processPdf(fileName, idioma) {
    const filePath = path.join(DOCS_DIR, fileName);
    try {
        const pdfBuffer = fs.readFileSync(filePath);
        const pdfBase64 = pdfBuffer.toString('base64');
        const response = await axios.post(API_URL, {
            pdfBase64,
            idioma
        }, { timeout: 600000 });
        return response.data;
    } catch (err) {
        if (err.code === 'ENOENT') {
            return { error: `Archivo no encontrado: ${fileName}` };
        }
        return { error: err.message || 'Error procesando PDF' };
    }
}

async function main() {
    const files = Object.keys(pdfIdiomas);
    const rows = [];
    for (const file of files) {
        const idioma = pdfIdiomas[file];
        console.log(`[INICIO] Procesando archivo: ${file} | Idioma: ${idioma}`);
        const startTime = Date.now();
        const result = await processPdf(file, idioma);
        const elapsedMs = Date.now() - startTime;
        const elapsedSec = (elapsedMs / 1000).toFixed(2);
        if (result.error) {
            console.log(`[ERROR] ${file}: ${result.error} | Tiempo: ${elapsedSec}s`);
            rows.push({
                archivo: file,
                idioma,
                paginasInput: 'ERROR',
                albaranesExtraidos: 'ERROR',
                pag: 'ERROR',
                departamento: 'ERROR',
                numeroOrden: 'ERROR',
                numeroRecibo: 'ERROR',
                total: 'ERROR',
                statusError: 'ERROR',
                mensaje: result.error,
                statusErrorGlobal: 'ERROR',
                mensajeGlobal: result.error,
                tiempoSegundos: elapsedSec
            });
            continue;
        }
        
        if (Array.isArray(result.datos) && result.datos.length > 0) {
            for (const d of result.datos) {
                rows.push({
                    archivo: file,
                    idioma,
                    paginasInput: result.paginasInput || '',
                    albaranesExtraidos: result.albaranesExtraidos || '',
                    pag: d.pag || 'NO EXTRAÍDO',
                    departamento: d.departamento || 'NO EXTRAÍDO',
                    numeroOrden: d.numeroOrden || 'NO EXTRAÍDO',
                    numeroRecibo: d.numeroRecibo || 'NO EXTRAÍDO',
                    total: typeof d.total !== 'undefined' ? d.total : 'NO EXTRAÍDO',
                    statusError: typeof d.statusError !== 'undefined' ? d.statusError : 'NO EXTRAÍDO',
                    mensaje: d.mensaje || '',
                    statusErrorGlobal: result.statusError || '',
                    mensajeGlobal: result.mensaje || '',
                    tiempoSegundos: elapsedSec
                });
            }
            console.log(`[OK] ${file}: ${result.datos.length} albaranes extraídos | Tiempo: ${elapsedSec}s`);
        } else {
            
            console.log(`[SIN DATOS] ${file}: No se extrajo ningún albarán | Tiempo: ${elapsedSec}s`);
            rows.push({
                archivo: file,
                idioma,
                paginasInput: result.paginasInput || '',
                albaranesExtraidos: result.albaranesExtraidos || '',
                pag: 'NO EXTRAÍDO',
                departamento: 'NO EXTRAÍDO',
                numeroOrden: 'NO EXTRAÍDO',
                numeroRecibo: 'NO EXTRAÍDO',
                total: 'NO EXTRAÍDO',
                statusError: 'NO EXTRAÍDO',
                mensaje: '',
                statusErrorGlobal: result.statusError || '',
                mensajeGlobal: result.mensaje || '',
                tiempoSegundos: elapsedSec
            });
        }
    }
    // Crear Excel
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Informe OCR');
    XLSX.writeFile(wb, OUTPUT_XLSX);
    console.log(`Informe generado: ${OUTPUT_XLSX}`);
}

main();
