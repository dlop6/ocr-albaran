const fs = require('fs');
const path = require('path');

const testsDir = path.join(__dirname, 'test');

fs.readdirSync(testsDir)
  .filter(file => file.endsWith('.test.js'))
  .sort()
  .forEach(file => {
    require(path.join(testsDir, file));
  });
