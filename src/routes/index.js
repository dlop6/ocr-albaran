// Agregador de rutas - combina todos los módulos de rutas
const express = require('express');
const router = express.Router();
const processRoutes = require('./processRoutes');
const healthRoutes = require('./healthRoutes');

// Montar módulos de rutas
router.use('/api', processRoutes);
router.use('/', healthRoutes);

module.exports = router;
