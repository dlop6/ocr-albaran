// test-require-poppler.js
console.log('Antes de require pdf-poppler');
try {
  require('pdf-poppler');
  console.log('pdf-poppler OK');
} catch (e) {
  console.error('pdf-poppler ERROR:', e.message);
}
console.log('Después de require pdf-poppler');
