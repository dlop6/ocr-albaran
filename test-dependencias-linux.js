// Prueba mínima para detectar qué dependencia lanza "linux is NOT supported."
try {
  require('tesseract.js');
  console.log('tesseract.js OK');
} catch (e) {
  console.error('tesseract.js ERROR:', e.message);
}

try {
  require('sharp');
  console.log('sharp OK');
} catch (e) {
  console.error('sharp ERROR:', e.message);
}

try {
  require('pdf-poppler');
  console.log('pdf-poppler OK');
} catch (e) {
  console.error('pdf-poppler ERROR:', e.message);
}

console.log('FIN DE PRUEBA');
