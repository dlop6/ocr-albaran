// Servicio para callbacks a Bizagi
const axios = require('axios');
const logger = require('../logger');
const config = require('../config/env');

// Estado en memoria para trackear fallos de callback
const jobCallbackState = new Map();

// Transformar datos del OCR al formato Bizagi con startParameters y xpath
function transformToBizagiFormat(data) {
	const { paginasInput, albaranesExtraidos, datos, paginasBlancas, statusError, mensaje } = data;

	// Construir colección de albaranes (rows)
	const rows = datos.map(albaran => ({
		columns: [
			{
				xpath: "m_CFEL_Albaranes.iPagina",
				value: albaran.pag || albaran.pageNumber
			},
			{
				xpath: "m_CFEL_Albaranes.sDepartamento",
				value: albaran.departamento || ""
			},
			{
				xpath: "m_CFEL_Albaranes.sOrdenCompra",
				value: albaran.numeroOrden || ""
			},
			{
				xpath: "m_CFEL_Albaranes.sRecibo",
				value: albaran.numeroRecibo || ""
			},
			{
				xpath: "m_CFEL_Albaranes.bStatusError",
				value: albaran.statusError || false
			},
			{
				xpath: "m_CFEL_Albaranes.sMensaje",
				value: albaran.mensaje || ""
			},
			{
				xpath: "m_CFEL_Albaranes.sTotal",
				value: albaran.total || null
			}
		]
	}));

	// Construir estructura completa de startParameters
	const startParameters = [
		{
			xpath: "m_CFEL_CobroFacturas.Datos",
			type: "collection",
			rows: rows
		},
		{
			xpath: "m_CFEL_CobroFacturas.iPaginasInput",
			value: paginasInput
		},
		{
			xpath: "m_CFEL_CobroFacturas.iAlbaranesExtraidos",
			value: albaranesExtraidos
		},
		{
			xpath: "m_CFEL_CobroFacturas.bStatusError",
			value: statusError
		},
		{
			xpath: "m_CFEL_CobroFacturas.sMensaje",
			value: mensaje || ""
		}
	];

	return { startParameters };
}

// Enviar resultados del OCR al endpoint de Bizagi
async function sendCallback(caseId, data) {
	if (!config.BIZAGI_BASE_URL || !config.BIZAGI_TOKEN) {
		const error = 'BIZAGI_BASE_URL or BIZAGI_TOKEN not configured';
		logger.warn(`[CALLBACK] ${error}. Skipping callback.`);
		jobCallbackState.set(caseId, { callbackFailed: true, error: 'missing-bizagi-config' });
		return { success: false, error };
	}

	const url = `${config.BIZAGI_BASE_URL.replace(/\/$/, '')}/odata/data/cases/${caseId}/events/EvtOCRCompletado/next`;
	
	// Transformar datos al formato Bizagi
	const bizagiPayload = transformToBizagiFormat(data);
	
	try {
		await axios.post(url, bizagiPayload, {
			headers: {
				'Authorization': `Bearer ${config.BIZAGI_TOKEN}`,
				'Content-Type': 'application/json'
			},
			timeout: 15000
		});
		
		logger.info(`[CALLBACK] Callback Bizagi OK para caseId=${caseId}`);
		jobCallbackState.set(caseId, { callbackFailed: false });
		return { success: true };
	} catch (error) {
		const errorMsg = error.message || 'Unknown error';
		logger.error(`[CALLBACK] Error al notificar Bizagi para caseId=${caseId}: ${errorMsg}`);
		jobCallbackState.set(caseId, { callbackFailed: true, error: errorMsg });
		return { success: false, error: errorMsg };
	}
}

// Obtener estado del callback para un caseId
function getCallbackState(caseId) {
	return jobCallbackState.get(caseId);
}

// Limpiar estado del callback para un caseId
function clearCallbackState(caseId) {
	jobCallbackState.delete(caseId);
}

module.exports = {
	sendCallback,
	getCallbackState,
	clearCallbackState,
	transformToBizagiFormat, // Exportado para testing
	jobCallbackState, // Exportado para debugging si es necesario
};
