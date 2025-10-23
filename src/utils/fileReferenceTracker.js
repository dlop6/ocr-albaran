const fs = require('fs/promises');
const { constants } = require('fs');
const logger = require('../logger');

async function fileExists(filePath) {
        if (!filePath) return false;
        try {
                await fs.access(filePath, constants.F_OK);
                return true;
        } catch (err) {
                return false;
        }
}

async function removeFile(filePath) {
        if (!filePath) return;
        if (!(await fileExists(filePath))) {
                return;
        }
        try {
                await fs.unlink(filePath);
        } catch (err) {
                if (err && err.code !== 'ENOENT') {
                        logger.warn(`[CLEANUP] No se pudo eliminar ${filePath}: ${err.message}`);
                }
        }
}

class FileReferenceTracker {
        constructor() {
                this._counts = new Map();
        }

        acquire(filePath) {
                if (!filePath) return;
                const current = this._counts.get(filePath) || 0;
                this._counts.set(filePath, current + 1);
        }

        async release(filePath) {
                if (!filePath) return;
                if (!this._counts.has(filePath)) {
                        return;
                }
                const next = this._counts.get(filePath) - 1;
                if (next <= 0) {
                        this._counts.delete(filePath);
                        await removeFile(filePath);
                } else {
                        this._counts.set(filePath, next);
                }
        }

        getActiveFiles() {
                return new Set(this._counts.keys());
        }

        async releaseAll() {
                const files = Array.from(this._counts.keys());
                this._counts.clear();
                await Promise.all(files.map(removeFile));
        }

        isEmpty() {
                return this._counts.size === 0;
        }
}

module.exports = FileReferenceTracker;
