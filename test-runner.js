#!/usr/bin/env node

/**
 * Script de prueba integral para el sistema de polling OCR
 * Uso: node test-runner.js [opciones]
 */

const fs = require('fs');
const path = require('path');

// Configuración
const CONFIG = {
    apiUrl: process.env.API_URL || 'http://localhost:3000',
    testPdfs: [
        './docs/albaran ingles.pdf',
        './docs/albaran español baja calidad.pdf', 
        './docs/EJEMPLO 1.pdf'
    ],
    pollInterval: 2000,
    maxWaitTime: 180000, // 3 minutos
    verbose: process.argv.includes('--verbose') || process.argv.includes('-v')
};

class TestRunner {
    constructor() {
        this.results = [];
    }

    log(message, level = 'info') {
        const timestamp = new Date().toISOString().substr(11, 8);
        const prefix = {
            info: '📋',
            success: '✅', 
            error: '❌',
            warn: '⚠️',
            debug: '🔍'
        }[level] || 'ℹ️';
        
        console.log(`[${timestamp}] ${prefix} ${message}`);
    }

    async checkServerHealth() {
        try {
            const response = await fetch(`${CONFIG.apiUrl}/health`);
            if (!response.ok) {
                throw new Error(`Server health check failed: ${response.status}`);
            }
            
            const health = await response.json();
            this.log(`Server health: Tesseract=${health.tesseract}, Poppler=${health.poppler}`, 'success');
            return true;
        } catch (error) {
            this.log(`Server not accessible: ${error.message}`, 'error');
            return false;
        }
    }

    async findTestPdf() {
        for (const pdfPath of CONFIG.testPdfs) {
            if (fs.existsSync(pdfPath)) {
                this.log(`Using test PDF: ${pdfPath}`);
                return pdfPath;
            }
        }
        throw new Error('No test PDF found. Available options: ' + CONFIG.testPdfs.join(', '));
    }

    async loadPdf(pdfPath) {
        try {
            let pdfBase64;
            const fileSize = fs.statSync(pdfPath).size;
            
            // Solo permitir archivos PDF directos
            const pdfBuffer = fs.readFileSync(pdfPath);
            pdfBase64 = pdfBuffer.toString('base64');
            this.log(`Loaded PDF file: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
            
            return pdfBase64;
        } catch (error) {
            throw new Error(`Error loading PDF: ${error.message}`);
        }
    }

    async startOcrJob(pdfBase64) {
        const payload = {
            pdfBase64: pdfBase64,
            idioma: 'ING',
            albaranesEsperados: 1
        };

        const response = await fetch(`${CONFIG.apiUrl}/api/start-process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Failed to start job: ${error.error || response.status}`);
        }

        const data = await response.json();
        this.log(`Job started: ${data.jobId}`, 'success');
        return data.jobId;
    }

    async pollJobStatus(jobId) {
        const startTime = Date.now();
        let currentStatus = 'pendiente';
        let pollCount = 0;

        this.log(`Polling job ${jobId}...`);

        while (Date.now() - startTime < CONFIG.maxWaitTime) {
            pollCount++;
            
            try {
                const response = await fetch(`${CONFIG.apiUrl}/api/job-status/${jobId}`);
                
                if (!response.ok) {
                    throw new Error(`Status check failed: ${response.status}`);
                }

                const statusData = await response.json();
                
                if (statusData.status !== currentStatus) {
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    this.log(`Status: ${currentStatus} → ${statusData.status} (${elapsed}s)`);
                    currentStatus = statusData.status;
                }

                if (['terminado', 'error'].includes(statusData.status)) {
                    const totalTime = Math.round((Date.now() - startTime) / 1000);
                    this.log(`Job completed in ${totalTime}s after ${pollCount} polls`, 'success');
                    return statusData.status;
                }

                if (CONFIG.verbose) {
                    this.log(`Poll ${pollCount}: ${statusData.status}`, 'debug');
                }

                await new Promise(resolve => setTimeout(resolve, CONFIG.pollInterval));

            } catch (error) {
                this.log(`Polling error: ${error.message}`, 'error');
                throw error;
            }
        }

        throw new Error(`Timeout: Job did not complete in ${CONFIG.maxWaitTime / 1000}s`);
    }

    async getJobResult(jobId) {
        const response = await fetch(`${CONFIG.apiUrl}/api/job-result/${jobId}`);
        
        if (!response.ok && response.status !== 404) {
            throw new Error(`Failed to get result: ${response.status}`);
        }

        const result = await response.json();
        
        this.log(`Result: ${result.paginasInput} pages, ${result.albaranesExtraidos} documents extracted`);
        
        if (result.statusError) {
            this.log(`Processing error: ${result.mensaje}`, 'warn');
        } else {
            this.log(`Success: ${result.mensaje}`, 'success');
        }

        return result;
    }

    async runSingleTest() {
        const testStart = Date.now();
        
        try {
            // 1. Health check
            this.log('Checking server health...');
            const healthy = await this.checkServerHealth();
            if (!healthy) {
                throw new Error('Server is not healthy');
            }

            // 2. Load PDF
            this.log('Loading test PDF...');
            const pdfPath = await this.findTestPdf();
            const pdfBase64 = await this.loadPdf(pdfPath);

            // 3. Start job
            this.log('Starting OCR job...');
            const jobId = await this.startOcrJob(pdfBase64);

            // 4. Poll status
            this.log('Polling job status...');
            const finalStatus = await this.pollJobStatus(jobId);

            // 5. Get result
            this.log('Getting final result...');
            const result = await this.getJobResult(jobId);

            const testDuration = Math.round((Date.now() - testStart) / 1000);
            
            const testResult = {
                success: true,
                jobId: jobId,
                duration: testDuration,
                status: finalStatus,
                result: result,
                error: null
            };

            this.results.push(testResult);
            this.log(`Test completed successfully in ${testDuration}s`, 'success');
            
            return testResult;

        } catch (error) {
            const testDuration = Math.round((Date.now() - testStart) / 1000);
            
            const testResult = {
                success: false,
                jobId: null,
                duration: testDuration,
                status: 'error',
                result: null,
                error: error.message
            };

            this.results.push(testResult);
            this.log(`Test failed after ${testDuration}s: ${error.message}`, 'error');
            
            return testResult;
        }
    }

    async runMultipleTests(count = 1) {
        this.log(`Running ${count} test(s) against ${CONFIG.apiUrl}`);
        
        for (let i = 1; i <= count; i++) {
            this.log(`\n========== TEST ${i}/${count} ==========`);
            await this.runSingleTest();
            
            if (i < count) {
                this.log('Waiting 5s before next test...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        this.printSummary();
    }

    printSummary() {
        console.log('\n' + '='.repeat(50));
        console.log('📊 TEST SUMMARY');
        console.log('='.repeat(50));

        const successful = this.results.filter(r => r.success).length;
        const total = this.results.length;
        const avgDuration = this.results.reduce((sum, r) => sum + r.duration, 0) / total;

        console.log(`\n✅ Successful: ${successful}/${total}`);
        console.log(`⏱️  Average duration: ${avgDuration.toFixed(1)}s`);

        if (successful < total) {
            console.log('\n❌ FAILURES:');
            this.results.filter(r => !r.success).forEach((result, i) => {
                console.log(`   ${i + 1}. ${result.error}`);
            });
        }

        if (successful > 0) {
            console.log('\n📋 SUCCESSFUL RESULTS:');
            this.results.filter(r => r.success).forEach((result, i) => {
                const r = result.result;
                console.log(`   ${i + 1}. ${r.paginasInput} pages → ${r.albaranesExtraidos} docs (${result.duration}s)`);
            });
        }

        console.log('\n' + '='.repeat(50));
        
        if (successful === total) {
            console.log('🎉 All tests passed!');
            process.exit(0);
        } else {
            console.log('💥 Some tests failed!');
            process.exit(1);
        }
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
OCR Polling Test Runner

Usage: node test-runner.js [options]

Options:
  --help, -h      Show this help
  --verbose, -v   Verbose output
  --count N       Run N tests (default: 1)
  --url URL       API URL (default: http://localhost:3000)

Environment:
  API_URL         Set API URL via environment variable

Examples:
  node test-runner.js                    # Single test
  node test-runner.js --count 3          # Run 3 tests
  node test-runner.js --verbose          # Verbose output
  API_URL=https://example.com node test-runner.js
        `);
        process.exit(0);
    }

    // Parse arguments
    const countIndex = args.indexOf('--count');
    const count = countIndex >= 0 ? parseInt(args[countIndex + 1]) || 1 : 1;
    
    const urlIndex = args.indexOf('--url');
    if (urlIndex >= 0) {
        CONFIG.apiUrl = args[urlIndex + 1];
    }

    const runner = new TestRunner();
    
    try {
        await runner.runMultipleTests(count);
    } catch (error) {
        console.error('\n💥 Fatal error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = TestRunner;