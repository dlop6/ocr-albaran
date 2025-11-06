// Rutas para procesamiento OCR
const express = require('express');
const router = express.Router();
const ocrJobService = require('../services/ocrJobService');

// POST /api/process-pdf - Encolar job OCR y retornar inmediatamente
router.post('/process-pdf', async (req, res) => {
	const { pdfBase64, idioma, albaranesEsperados, caseId } = req.body;

	// Validar idioma
	const idiomaInput = (typeof idioma === 'string') ? idioma.trim().toUpperCase() : '';
	if (!['ESP', 'ING'].includes(idiomaInput)) {
		return res.status(400).json({
			error: 'El campo "idioma" es obligatorio y debe ser "ESP" o "ING".'
		});
	}

	// Validar caseId
	if (typeof caseId === 'undefined' || !Number.isInteger(Number(caseId))) {
		return res.status(400).json({
			error: 'El campo "caseId" es obligatorio y debe ser un entero.'
		});
	}

	// Validar albaranesEsperados (opcional)
	let albaranesEsperadosValue = undefined;
	if (typeof albaranesEsperados !== 'undefined') {
		const n = Number(albaranesEsperados);
		if (!Number.isInteger(n) || n < 0) {
			return res.status(400).json({
				error: 'El campo "albaranesEsperados" debe ser un número entero positivo si se proporciona.'
			});
		}
		albaranesEsperadosValue = n;
	}

	// Validar base64
	if (!pdfBase64 || typeof pdfBase64 !== 'string') {
		return res.status(400).json({ error: 'pdfBase64 must be a non-empty string' });
	}

	try {
		// Verificar que el base64 es decodificable
		Buffer.from(pdfBase64, 'base64');
	} catch (err) {
		return res.status(400).json({ error: 'Invalid base64 format' });
	}

	// Encolar job OCR de forma asíncrona (fire-and-forget)
	ocrJobService.processOcrJob(
		pdfBase64,
		idiomaInput,
		albaranesEsperadosValue,
		Number(caseId)
	).catch(err => {
		// Los errores ya se registran en ocrJobService
		// Este catch previene rechazos de promesas no manejados
	});

	// Retornar inmediatamente con estado encolado
	return res.status(200).json({
		status: 'queued',
		caseId: Number(caseId)
	});
});

module.exports = router;
