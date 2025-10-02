const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

class JobManager {
    constructor() {
        // Almacenamiento en memoria de los trabajos
        this.jobs = new Map();
        
        // Estados posibles: 'pendiente', 'procesando', 'terminado', 'error'
        this.JOB_STATES = {
            PENDING: 'pendiente',
            PROCESSING: 'procesando', 
            COMPLETED: 'terminado',
            ERROR: 'error'
        };

        // Formato de resultado por defecto
        this.DEFAULT_RESULT = {
            paginasInput: 0,
            albaranesExtraidos: 0,
            datos: [],
            statusError: false,
            mensaje: ""
        };
    }

    /**
     * Crea un nuevo trabajo OCR
     * @param {string} pdfBase64 - PDF en base64
     * @param {object} options - Opciones adicionales (idioma, albaranes esperados)
     * @returns {string} jobId - ID único del trabajo
     */
    createJob(pdfBase64, options = {}) {
        const jobId = uuidv4();
        
        const job = {
            id: jobId,
            pdfBase64: pdfBase64,
            options: options,
            status: this.JOB_STATES.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
            result: null,
            error: null
        };

        this.jobs.set(jobId, job);
        
        logger.info(`[JobManager] Trabajo creado: ${jobId}`, {
            jobId: jobId,
            status: this.JOB_STATES.PENDING,
            options: options
        });

        return jobId;
    }

    /**
     * Cambia el estado del trabajo a 'procesando'
     * @param {string} jobId - ID del trabajo
     * @returns {boolean} - True si se actualizó correctamente
     */
    setJobProcessing(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            logger.warn(`[JobManager] Trabajo no encontrado: ${jobId}`);
            return false;
        }

        job.status = this.JOB_STATES.PROCESSING;
        job.updatedAt = new Date();
        
        logger.info(`[JobManager] Trabajo en procesamiento: ${jobId}`);
        return true;
    }

    /**
     * Guarda el resultado exitoso del trabajo
     * @param {string} jobId - ID del trabajo
     * @param {object} result - Resultado del procesamiento OCR
     * @returns {boolean} - True si se guardó correctamente
     */
    setJobResult(jobId, result) {
        const job = this.jobs.get(jobId);
        if (!job) {
            logger.warn(`[JobManager] Trabajo no encontrado: ${jobId}`);
            return false;
        }

        // Asegurar que el resultado tenga el formato correcto
        const formattedResult = {
            ...this.DEFAULT_RESULT,
            ...result,
            statusError: false
        };

        job.status = this.JOB_STATES.COMPLETED;
        job.result = formattedResult;
        job.updatedAt = new Date();
        
        logger.info(`[JobManager] Trabajo completado: ${jobId}`, {
            jobId: jobId,
            paginasInput: formattedResult.paginasInput,
            albaranesExtraidos: formattedResult.albaranesExtraidos
        });

        return true;
    }

    /**
     * Guarda el error del trabajo
     * @param {string} jobId - ID del trabajo
     * @param {string} errorMessage - Mensaje de error
     * @param {object} partialResult - Resultado parcial si existe
     * @returns {boolean} - True si se guardó correctamente
     */
    setJobError(jobId, errorMessage, partialResult = {}) {
        const job = this.jobs.get(jobId);
        if (!job) {
            logger.warn(`[JobManager] Trabajo no encontrado: ${jobId}`);
            return false;
        }

        // Crear resultado con error pero manteniendo formato
        const errorResult = {
            ...this.DEFAULT_RESULT,
            ...partialResult,
            statusError: true,
            mensaje: errorMessage
        };

        job.status = this.JOB_STATES.ERROR;
        job.result = errorResult;
        job.error = errorMessage;
        job.updatedAt = new Date();
        
        logger.error(`[JobManager] Trabajo con error: ${jobId}`, {
            jobId: jobId,
            error: errorMessage
        });

        return true;
    }

    /**
     * Obtiene el estado actual del trabajo
     * @param {string} jobId - ID del trabajo
     * @returns {string|null} - Estado del trabajo o null si no existe
     */
    getJobStatus(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            return null;
        }
        return job.status;
    }

    /**
     * Obtiene el resultado del trabajo
     * @param {string} jobId - ID del trabajo
     * @returns {object|null} - Resultado del trabajo o null si no existe/no está listo
     */
    getJobResult(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            return null;
        }

        // Si el trabajo está completado o con error, devolver resultado
        if (job.status === this.JOB_STATES.COMPLETED || job.status === this.JOB_STATES.ERROR) {
            return job.result;
        }

        // Si está pendiente o procesando, devolver formato con mensaje de estado
        return {
            ...this.DEFAULT_RESULT,
            statusError: false,
            mensaje: job.status === this.JOB_STATES.PENDING ? 
                'Trabajo en cola, pendiente de procesamiento' : 
                'Trabajo en procesamiento, intente más tarde'
        };
    }

    /**
     * Obtiene todos los trabajos pendientes para procesamiento
     * @returns {Array} - Array de trabajos pendientes
     */
    getPendingJobs() {
        const pendingJobs = [];
        for (const [jobId, job] of this.jobs) {
            if (job.status === this.JOB_STATES.PENDING) {
                pendingJobs.push({
                    id: jobId,
                    pdfBase64: job.pdfBase64,
                    options: job.options
                });
            }
        }
        return pendingJobs;
    }

    /**
     * Limpia trabajos antiguos para evitar fuga de memoria
     * @param {number} maxAgeHours - Edad máxima en horas (por defecto 24)
     */
    cleanOldJobs(maxAgeHours = 24) {
        const now = new Date();
        const maxAge = maxAgeHours * 60 * 60 * 1000; // Convertir a milisegundos
        
        let cleanedCount = 0;
        for (const [jobId, job] of this.jobs) {
            if (now - job.updatedAt > maxAge) {
                this.jobs.delete(jobId);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            logger.info(`[JobManager] Trabajos antiguos eliminados: ${cleanedCount}`);
        }
    }

    /**
     * Obtiene estadísticas de trabajos
     * @returns {object} - Estadísticas de trabajos por estado
     */
    getStats() {
        const stats = {
            total: this.jobs.size,
            pendiente: 0,
            procesando: 0,
            terminado: 0,
            error: 0
        };

        for (const [jobId, job] of this.jobs) {
            stats[job.status]++;
        }

        return stats;
    }
}

module.exports = new JobManager();