const test = require('node:test');
const assert = require('node:assert');
const { hasValidOrientation, isRelevantPage, parseDocument } = require('../src/parser');

test('isRelevantPage matches default keywords ignoring case and accents', () => {
    const text = 'DETALLES DEL RECIBO\nInformación adicional';
    assert.strictEqual(isRelevantPage(text), true);

    const textWithAccents = 'Detallés   del Recíbo con tildes';
    assert.strictEqual(isRelevantPage(textWithAccents), true);
});

test('parseDocument filters pages using default keywords', () => {
    const pages = [
        { text: 'Contenido irrelevante', pageNumber: 1 },
        { text: 'Proof of Delivery details here', pageNumber: 2 },
        { text: 'Más datos sin relevancia', pageNumber: 3 }
    ];
    const result = parseDocument(pages);
    assert.deepStrictEqual(result, [
        { text: 'Proof of Delivery details here', pageNumber: 2 }
    ]);
});

test('parseDocument accepts custom keyword overrides', () => {
    const customPages = [
        { text: 'Resumen mensual', pageNumber: 1 },
        { text: 'Factura Especial número 123', pageNumber: 2 }
    ];
    const customKeywords = ['Factura Especial'];
    const result = parseDocument(customPages, customKeywords);
    assert.deepStrictEqual(result, [
        { text: 'Factura Especial número 123', pageNumber: 2 }
    ]);
});

test('hasValidOrientation checks orientation keywords per language', () => {
    assert.strictEqual(hasValidOrientation('Prueba DETALLES DE RECIBO', 'spa'), true);
    assert.strictEqual(hasValidOrientation('Proof of Receipt data', 'eng'), true);
    assert.strictEqual(hasValidOrientation('Texto sin señales claras', 'spa'), false);
});

