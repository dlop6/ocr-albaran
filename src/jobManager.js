const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

/**
 * Administrador de trabajos para procesamiento asíncrono con polling
 */
class JobManager {
    constructor() {
        // Almacenamiento en memoria de trabajos activos
        this.jobs = new Map();
        
        // Iniciar limpieza automática cada hora
        this.startCleanupTimer();
    }

    /**
     * Crea un nuevo trabajo de procesamiento
     * @param {object} inputData - {pdfBase64, idioma, albaranesEsperados}
     * @returns {string} requestId - UUID único del trabajo
     */
    createJob(inputData) {
        const requestId = uuidv4();
        const now = new Date();
        
        const job = {
            requestId,
            status: 'pending', // pending|processing|completed|error
            createdAt: now,
            updatedAt: now,
            inputData: {
                pdfBase64: inputData.pdfBase64,
                idioma: inputData.idioma,
                albaranesEsperados: inputData.albaranesEsperados
            },
            result: null, // resultado final cuando completed
            error: null,  // mensaje error cuando error
            progress: '', // mensaje progreso actual
            metadata: {
                pageCount: 0,
                pdfSizeMB: 0,
                estimatedTimeMinutes: 0
            }
        };

        this.jobs.set(requestId, job);
        logger.info(`[JOB ${requestId}] Trabajo creado: ${inputData.idioma}`);
        
        return requestId;
    }

    /**
     * Obtiene un trabajo por su ID
     * @param {string} requestId 
     * @returns {object|null} job o null si no existe
     */
    getJob(requestId) {
        return this.jobs.get(requestId) || null;
    }

    /**
     * Actualiza el estado de un trabajo
     * @param {string} requestId 
     * @param {string} status - nuevo estado
     * @param {object} updates - campos adicionales a actualizar
     */
    updateJob(requestId, status, updates = {}) {
        const job = this.jobs.get(requestId);
        if (!job) {
            logger.warn(`[JOB ${requestId}] Intento de actualizar trabajo inexistente`);
            return false;
        }

        job.status = status;
        job.updatedAt = new Date();
        
        // Aplicar actualizaciones adicionales
        Object.assign(job, updates);
        
        logger.info(`[JOB ${requestId}] Estado actualizado: ${status}`);
        return true;
    }

    /**
     * Marca un trabajo como en progreso
     * @param {string} requestId 
     * @param {object} metadata - metadatos del PDF (pageCount, pdfSizeMB)
     */
    startProcessing(requestId, metadata = {}) {
        const updates = {
            metadata: {
                ...this.getJob(requestId)?.metadata,
                ...metadata
            }
        };
        return this.updateJob(requestId, 'processing', updates);
    }

    /**
     * Marca un trabajo como completado con resultado
     * @param {string} requestId 
     * @param {object} result - resultado del procesamiento
     */
    completeJob(requestId, result) {
        return this.updateJob(requestId, 'completed', { result });
    }

    /**
     * Marca un trabajo como fallido con error
     * @param {string} requestId 
     * @param {string} errorMessage 
     */
    failJob(requestId, errorMessage) {
        return this.updateJob(requestId, 'error', { error: errorMessage });
    }

    /**
     * Actualiza el progreso de un trabajo
     * @param {string} requestId 
     * @param {string} progressMessage 
     */
    updateProgress(requestId, progressMessage) {
        const job = this.jobs.get(requestId);
        if (job) {
            job.progress = progressMessage;
            job.updatedAt = new Date();
            logger.info(`[JOB ${requestId}] Progreso: ${progressMessage}`);
        }
    }

    /**
     * Elimina un trabajo del almacenamiento
     * @param {string} requestId 
     */
    deleteJob(requestId) {
        const deleted = this.jobs.delete(requestId);
        if (deleted) {
            logger.info(`[JOB ${requestId}] Trabajo eliminado`);
        }
        return deleted;
    }

    /**
     * Obtiene todos los trabajos activos (para debugging)
     * @returns {Array} lista de trabajos sin el pdfBase64
     */
    getAllJobs() {
        const jobs = [];
        for (const [requestId, job] of this.jobs.entries()) {
            // Excluir pdfBase64 para evitar logs grandes
            const jobCopy = {
                ...job,
                inputData: {
                    ...job.inputData,
                    pdfBase64: job.inputData.pdfBase64 ? '[HIDDEN]' : null
                }
            };
            jobs.push(jobCopy);
        }
        return jobs;
    }

    /**
     * Limpia trabajos antiguos (>24 horas)
     */
    cleanupOldJobs() {
        const now = new Date();
        const maxAge = 24 * 60 * 60 * 1000; // 24 horas en ms
        let cleanedCount = 0;

        for (const [requestId, job] of this.jobs.entries()) {
            const age = now - job.createdAt;
            if (age > maxAge) {
                this.deleteJob(requestId);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            logger.info(`[CLEANUP] Eliminados ${cleanedCount} trabajos antiguos`);
        }
    }

    /**
     * Inicia el timer de limpieza automática
     */
    startCleanupTimer() {
        // Limpiar cada hora
        setInterval(() => {
            this.cleanupOldJobs();
        }, 60 * 60 * 1000);
        
        logger.info('[JobManager] Timer de limpieza automática iniciado (cada 1 hora)');
    }

    /**
     * Obtiene estadísticas de trabajos
     * @returns {object} estadísticas
     */
    getStats() {
        const jobs = Array.from(this.jobs.values());
        return {
            total: jobs.length,
            pending: jobs.filter(j => j.status === 'pending').length,
            processing: jobs.filter(j => j.status === 'processing').length,
            completed: jobs.filter(j => j.status === 'completed').length,
            error: jobs.filter(j => j.status === 'error').length
        };
    }
}

// Exportar instancia singleton
module.exports = new JobManager();