const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { randomUUID } = require('crypto');

const FileReferenceTracker = require('../src/utils/fileReferenceTracker');
const pdfService = require('../src/pdfService');

async function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
}

async function pathExists(filePath) {
        try {
                await fs.access(filePath);
                return true;
        } catch (err) {
                return false;
        }
}

async function simulateRequest(pages = 3) {
        const requestId = randomUUID();
        const tempPdfPath = path.join(os.tmpdir(), `test-${requestId}.pdf`);
        const outputDir = path.join(os.tmpdir(), `test-images-${requestId}`);
        await fs.mkdir(outputDir, { recursive: true });
        await fs.writeFile(tempPdfPath, `dummy-${requestId}`);

        const tracker = new FileReferenceTracker();
        const pagePaths = [];
        for (let i = 1; i <= pages; i++) {
                const imagePath = path.join(outputDir, `page-${i}.png`);
                await fs.writeFile(imagePath, `image-${i}`);
                tracker.acquire(imagePath);
                pagePaths.push(imagePath);
        }

        const tasks = pagePaths.map((imagePath) => (async () => {
                tracker.acquire(imagePath);
                await sleep(40 + Math.floor(Math.random() * 40));
                await tracker.release(imagePath);
                await tracker.release(imagePath);
        })());

        const cleanupDuringOcr = pdfService.cleanupTempImages(outputDir, tracker.getActiveFiles());
        await cleanupDuringOcr;
        assert.strictEqual(await pathExists(outputDir), true, 'Output directory should persist while OCR is running');

        await Promise.all(tasks);
        await tracker.releaseAll();
        assert.strictEqual(tracker.isEmpty(), true, 'Tracker should not retain references after releaseAll');

        await pdfService.cleanupTempImages(outputDir);
        const dirExists = await pathExists(outputDir);
        if (dirExists) {
                const remaining = await fs.readdir(outputDir);
                assert.strictEqual(remaining.length, 0, 'Output directory should be empty after cleanup');
                await fs.rmdir(outputDir);
        }

        if (await pathExists(tempPdfPath)) {
                await fs.unlink(tempPdfPath);
        }

        return { outputDir };
}

async function run() {
        const concurrency = 5;
        const results = await Promise.all(Array.from({ length: concurrency }, () => simulateRequest()));
        const uniqueDirs = new Set(results.map(r => r.outputDir));
        assert.strictEqual(uniqueDirs.size, concurrency, 'Each request should create a unique directory');

        for (const { outputDir } of results) {
                const exists = await pathExists(outputDir);
                assert.strictEqual(exists, false, `Temporary directory ${outputDir} should be removed after cleanup`);
        }
}

module.exports = { run };
