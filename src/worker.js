const jobManager = require('./jobManager');
const pdfService = require('./pdfService');
const ocrService = require('./ocrService');
const fieldExtractor = require('./fieldExtractor');
const parser = require('./parser');
const logger = require('./logger');

class OCRWorker {
    constructor() {
        this.isProcessing = false;
        this.intervalId = null;
        this.processInterval = 5000; // Revisar trabajos cada 5 segundos
    }

    /**
     * Inicia el worker para procesar trabajos pendientes
     */
    start() {
        if (this.intervalId) {
            logger.warn('[Worker] Worker ya está ejecutándose');
            return;
        }

        logger.info('[Worker] Iniciando worker OCR');
        this.intervalId = setInterval(() => {
            this.processJobs();
        }, this.processInterval);
    }

    /**
     * Detiene el worker
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            logger.info('[Worker] Worker OCR detenido');
        }
    }

    /**
     * Procesa trabajos pendientes
     */
    async processJobs() {
        if (this.isProcessing) {
            return; // Ya hay un trabajo en procesamiento
        }

        const pendingJobs = jobManager.getPendingJobs();
        if (pendingJobs.length === 0) {
            return; // No hay trabajos pendientes
        }

        // Procesar el primer trabajo pendiente
        const job = pendingJobs[0];
        await this.processJob(job);
    }

    /**
     * Procesa un trabajo individual
     * @param {object} job - Trabajo a procesar
     */
    async processJob(job) {
        this.isProcessing = true;
        const { id: jobId, pdfBase64, options } = job;

        try {
            logger.info(`[Worker] Iniciando procesamiento del trabajo: ${jobId}`);
            
            // Marcar trabajo como en procesamiento
            jobManager.setJobProcessing(jobId);

            // Procesar el PDF usando la lógica existente
            const result = await this.processPdfOCR(pdfBase64, options);

            // Guardar resultado exitoso
            jobManager.setJobResult(jobId, result);
            
            logger.info(`[Worker] Trabajo completado exitosamente: ${jobId}`);

        } catch (error) {
            logger.error(`[Worker] Error procesando trabajo ${jobId}:`, {
                message: error.message,
                stack: error.stack?.split('\n')[0] // Solo primera línea del stack
            });
            
            // Guardar error manteniendo formato
            const errorMessage = error.message || 'Error desconocido durante el procesamiento OCR';
            
            // Verificar que el job todavía existe antes de actualizar
            const jobExists = jobManager.getJobStatus(jobId);
            if (jobExists === null) {
                logger.error(`[Worker] CRÍTICO: Trabajo ${jobId} desapareció durante el procesamiento`);
            } else {
                logger.info(`[Worker] Guardando error para trabajo ${jobId}: ${errorMessage}`);
                jobManager.setJobError(jobId, errorMessage);
            }
            
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Procesa un PDF usando la lógica OCR existente
     * @param {string} pdfBase64 - PDF en base64
     * @param {object} options - Opciones de procesamiento
     * @returns {object} - Resultado en el formato requerido
     */
    async processPdfOCR(pdfBase64, options = {}) {
        const startTime = Date.now();
        
        try {
            // Validar entrada
            if (!pdfBase64) {
                throw new Error('PDF base64 es requerido');
            }

            // Configurar opciones por defecto
            const idioma = options.idioma || 'SPA';
            const albaranesEsperados = options.albaranesEsperados || 1;

            logger.info('[Worker] Iniciando procesamiento OCR', {
                idioma: idioma,
                albaranesEsperados: albaranesEsperados,
                pdfSize: `${(pdfBase64.length * 0.75 / 1024 / 1024).toFixed(2)} MB`
            });

            // Cargar y validar PDF
            const pdfDoc = await pdfService.loadPdf(pdfBase64);
            const pageCount = await pdfService.getPageCount(pdfDoc);
            
            logger.info(`[Worker] PDF cargado: ${pageCount} páginas`);

            // Extraer imágenes de todas las páginas
            const images = [];
            for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
                try {
                    const imageBuffer = await pdfService.convertPageToImage(pdfDoc, pageNum);
                    images.push({
                        pageNumber: pageNum,
                        buffer: imageBuffer
                    });
                } catch (error) {
                    logger.warn(`[Worker] Error extrayendo página ${pageNum}:`, error.message);
                }
            }

            if (images.length === 0) {
                throw new Error('No se pudieron extraer imágenes del PDF');
            }

            // Procesar OCR en cada página
            const ocrResults = [];
            for (const image of images) {
                try {
                    const ocrText = await ocrService.processImage(image.buffer, idioma);
                    ocrResults.push({
                        pageNumber: image.pageNumber,
                        text: ocrText
                    });
                } catch (error) {
                    logger.warn(`[Worker] Error OCR página ${image.pageNumber}:`, error.message);
                    ocrResults.push({
                        pageNumber: image.pageNumber,
                        text: ''
                    });
                }
            }

            // Filtrar páginas relevantes
            const relevantPages = parser.filterRelevantPages(ocrResults);
            
            if (relevantPages.length === 0) {
                logger.warn('[Worker] No se encontraron páginas relevantes');
                return {
                    paginasInput: pageCount,
                    albaranesExtraidos: 0,
                    datos: [],
                    statusError: false,
                    mensaje: 'No se encontraron albaranes en el PDF'
                };
            }

            // Extraer datos de cada página relevante
            const extractedData = [];
            for (const page of relevantPages) {
                try {
                    const data = fieldExtractor.extractFields(page.text, page.pageNumber);
                    if (data) {
                        extractedData.push(data);
                    }
                } catch (error) {
                    logger.warn(`[Worker] Error extrayendo campos página ${page.pageNumber}:`, error.message);
                }
            }

            const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
            
            logger.info('[Worker] Procesamiento OCR completado', {
                paginasInput: pageCount,
                albaranesExtraidos: extractedData.length,
                tiempoProcesamiento: `${processingTime}s`,
                paginasRelevantes: relevantPages.length
            });

            // Retornar resultado en formato requerido
            return {
                paginasInput: pageCount,
                albaranesExtraidos: extractedData.length,
                datos: extractedData,
                statusError: false,
                mensaje: extractedData.length > 0 ? 
                    `PDF procesado correctamente: ${pageCount} páginas, ${processingTime}s, ${extractedData.length} albaranes extraídos` :
                    'PDF procesado pero no se encontraron datos válidos'
            };

        } catch (error) {
            const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
            
            logger.error('[Worker] Error en procesamiento OCR:', {
                error: error.message,
                tiempoProcesamiento: `${processingTime}s`
            });

            throw error; // Re-lanzar para que sea manejado por processJob
        }
    }

    /**
     * Obtiene estadísticas del worker
     * @returns {object} - Estadísticas del worker
     */
    getStats() {
        return {
            isRunning: !!this.intervalId,
            isProcessing: this.isProcessing,
            processInterval: this.processInterval,
            jobStats: jobManager.getStats()
        };
    }
}

module.exports = new OCRWorker();