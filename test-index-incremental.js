// Depuración incremental para detectar el origen de "linux is NOT supported."
console.log('Inicio depuración');

try {
  require('dotenv').config();
  console.log('dotenv OK');
} catch (e) {
  console.error('dotenv ERROR:', e.message);
}

try {
  const express = require('express');
  console.log('express OK');
} catch (e) {
  console.error('express ERROR:', e.message);
}

try {
  const bodyParser = require('body-parser');
  console.log('body-parser OK');
} catch (e) {
  console.error('body-parser ERROR:', e.message);
}

try {
  const fs = require('fs');
  console.log('fs OK');
} catch (e) {
  console.error('fs ERROR:', e.message);
}

try {
  const path = require('path');
  console.log('path OK');
} catch (e) {
  console.error('path ERROR:', e.message);
}

try {
  const pdfService = require('./src/pdfService');
  console.log('pdfService OK');
} catch (e) {
  console.error('pdfService ERROR:', e.message);
}

try {
  const ocrService = require('./src/ocrService');
  console.log('ocrService OK');
} catch (e) {
  console.error('ocrService ERROR:', e.message);
}

try {
  const pLimit = require('p-limit');
  console.log('pLimit OK');
} catch (e) {
  console.error('pLimit ERROR:', e.message);
}

try {
  const helmet = require('helmet');
  console.log('helmet OK');
} catch (e) {
  console.error('helmet ERROR:', e.message);
}

try {
  const cors = require('cors');
  console.log('cors OK');
} catch (e) {
  console.error('cors ERROR:', e.message);
}

try {
  const logger = require('./src/logger');
  console.log('logger OK');
} catch (e) {
  console.error('logger ERROR:', e.message);
}

try {
  const promClient = require('prom-client');
  console.log('promClient OK');
} catch (e) {
  console.error('promClient ERROR:', e.message);
}

try {
  const rateLimit = require('express-rate-limit');
  console.log('rateLimit OK');
} catch (e) {
  console.error('rateLimit ERROR:', e.message);
}

try {
  const os = require('os');
  console.log('os OK');
} catch (e) {
  console.error('os ERROR:', e.message);
}

console.log('FIN DE DEPURACIÓN');
