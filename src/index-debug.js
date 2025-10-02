// index-debug.js
// Instrumentación para detectar el origen de "linux is NOT supported."
console.log('INICIO index-debug');

process.on('warning', (warning) => {
  console.error('WARNING:', warning);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

try {
  require('dotenv').config();
  console.log('dotenv OK');
  const express = require('express');
  const app = express();
  console.log('express OK');
  const bodyParser = require('body-parser');
  const fs = require('fs');
  const path = require('path');
  const pdfService = require('./pdfService');
  const ocrService = require('./ocrService');
  const pLimit = require('p-limit');
  const helmet = require('helmet');
  const cors = require('cors');
  const logger = require('./logger');
  const promClient = require('prom-client');
  const rateLimit = require('express-rate-limit');
  const os = require('os');
  console.log('Todos los requires OK');

  // Instrumentar el arranque del servidor
  app.get('/', (req, res) => {
    res.send('OK');
  });
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
  });

} catch (e) {
  console.error('ERROR en index-debug:', e);
}

console.log('FIN index-debug');
