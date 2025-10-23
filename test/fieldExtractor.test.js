const test = require('node:test');
const assert = require('node:assert');
const { extractFieldsFromText } = require('../src/fieldExtractor');

test('extractFieldsFromText returns structured data for Spanish text', () => {
    const text = `DETALLES DEL RECIBO\nP.O: 12345678\nRecibo: 12-98765432\nDepto: 456\nTotal 1234,56`;
    const result = extractFieldsFromText(text, 2, 'ESP');
    assert.strictEqual(result.pag, 2);
    assert.strictEqual(result.numeroOrden, '12345678');
    assert.strictEqual(result.numeroRecibo, '12-98765432');
    assert.strictEqual(result.departamento, '456');
    assert.strictEqual(result.total, 1234.56);
    assert.strictEqual(result.statusError, false);
    assert.strictEqual(result.mensaje, '');
});

test('extractFieldsFromText flags missing data with error messages', () => {
    const text = `Contenido sin datos requeridos`;
    const result = extractFieldsFromText(text, 5, 'ESP');
    assert.strictEqual(result.pag, 5);
    assert.strictEqual(result.statusError, true);
    assert.ok(result.mensaje.includes('No se encontró Número de Orden'));
    assert.ok(result.mensaje.includes('No se encontró Recibo'));
    assert.ok(result.mensaje.includes('No se encontró Departamento'));
    assert.ok(result.mensaje.includes('No se encontró Total'));
});

test('extractFieldsFromText (ENG) omite total y extrae identificadores', () => {
    const text = `Proof of Receipt\nPO Number: 87654321\nReceiver: 99887766\nDepartment: 42`;
    const result = extractFieldsFromText(text, 1, 'ING');
    assert.strictEqual(result.pag, 1);
    assert.strictEqual(result.numeroOrden, '87654321');
    assert.strictEqual(result.numeroRecibo, '99887766');
    assert.strictEqual(result.departamento, '42');
    assert.strictEqual('total' in result, false);
    assert.strictEqual(result.statusError, false);
});

