const fs = require('fs/promises');
const path = require('path');

async function loadTestFiles() {
        const testDir = path.join(__dirname, 'test');
        const entries = await fs.readdir(testDir);
        return entries.filter(file => file.endsWith('.test.js'));
}

async function run() {
        const testFiles = await loadTestFiles();
        let passed = 0;
        for (const file of testFiles) {
                const modulePath = path.join(__dirname, 'test', file);
                const testModule = require(modulePath);
                if (typeof testModule.run !== 'function') {
                        throw new Error(`Test file ${file} must export a 'run' function`);
                }
                await testModule.run();
                console.log(`\u2713 ${file}`);
                passed++;
        }
        console.log(`\n${passed} test(s) passed.`);
}

run().catch(err => {
        console.error(err);
        process.exit(1);
});
