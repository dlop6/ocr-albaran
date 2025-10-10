const os = require('os');
const pLimit = require('p-limit');

// Determina concurrencia por defecto: si OCR_CONCURRENCY está definida la usa,
// si no se calcula a partir de la cantidad de CPUs disponibles (pero al menos 1).
const DEFAULT_CONCURRENCY = (() => {
  const env = process.env.OCR_CONCURRENCY;
  if (env) {
    const n = parseInt(env, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const cpus = os.cpus() ? os.cpus().length : 1;
  // Dejamos uno libre por seguridad si hay >1 CPU
  return Math.max(1, cpus - 1);
})();

const limit = pLimit(DEFAULT_CONCURRENCY);

module.exports = {
  DEFAULT_CONCURRENCY,
  limit
};
