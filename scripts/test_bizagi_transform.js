// Script para probar la transformación de datos al formato Bizagi
const { transformToBizagiFormat } = require('../src/services/bizagiService');

// Datos de ejemplo (formato interno del OCR)
const ocrData = {
	paginasInput: 3,
	albaranesExtraidos: 1,
	datos: [
		{
			pag: 2,
			departamento: "95",
			numeroOrden: "2551029785",
			numeroRecibo: "28-08150061",
			statusError: false,
			mensaje: "",
			total: 226.8,
			timeSeconds: 14.820368531
		}
	],
	paginasBlancas: [],
	statusError: false,
	mensaje: ""
};

console.log('=== Datos internos OCR ===');
console.log(JSON.stringify(ocrData, null, 2));

console.log('\n=== Transformación a formato Bizagi ===');
const bizagiPayload = transformToBizagiFormat(ocrData);
console.log(JSON.stringify(bizagiPayload, null, 2));

// Caso con error
const errorData = {
	paginasInput: 5,
	albaranesExtraidos: 0,
	datos: [],
	paginasBlancas: [1, 3],
	statusError: true,
	mensaje: "Error procesando PDF: timeout"
};

console.log('\n=== Caso de error ===');
console.log(JSON.stringify(transformToBizagiFormat(errorData), null, 2));

// Caso con múltiples albaranes
const multiData = {
	paginasInput: 10,
	albaranesExtraidos: 3,
	datos: [
		{
			pag: 2,
			departamento: "95",
			numeroOrden: "2551029785",
			numeroRecibo: "28-08150061",
			statusError: false,
			mensaje: "",
			total: 226.8
		},
		{
			pag: 5,
			departamento: "LOG",
			numeroOrden: "1234567890",
			numeroRecibo: "RV-12345",
			statusError: false,
			mensaje: "",
			total: 450.25
		},
		{
			pag: 8,
			departamento: "",
			numeroOrden: "",
			numeroRecibo: "RV-99999",
			statusError: true,
			mensaje: "Campos incompletos",
			total: null
		}
	],
	paginasBlancas: [1, 4, 7],
	statusError: true,
	mensaje: "1 albaranes parcialmente extraídos."
};

console.log('\n=== Caso con múltiples albaranes ===');
console.log(JSON.stringify(transformToBizagiFormat(multiData), null, 2));
