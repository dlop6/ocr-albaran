#!/usr/bin/env node
'use strict';

const { runBenchmark } = require('./test/preprocessing.benchmark');

(async () => {
  await runBenchmark();
})();
