import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClp, discountPercent, changePercent } from '../src/lib/money.js';

test('parseClp entiende el formato chileno con separador de miles', () => {
  assert.equal(parseClp('$129.990'), 129990);
  assert.equal(parseClp('129.990'), 129990);
  assert.equal(parseClp('$1.299.990'), 1299990);
  assert.equal(parseClp('  $ 9.990 '), 9990);
});

test('parseClp trata una coma final de 2 digitos como decimal', () => {
  assert.equal(parseClp('129990,00'), 129990);
  assert.equal(parseClp('12.990,50'), 12990);
});

test('parseClp acepta numeros directos de las APIs', () => {
  assert.equal(parseClp(129990), 129990);
  assert.equal(parseClp(12990.4), 12990);
});

test('parseClp rechaza basura y valores fuera de rango', () => {
  assert.equal(parseClp(''), null);
  assert.equal(parseClp('sin stock'), null);
  assert.equal(parseClp(null), null);
  assert.equal(parseClp(undefined), null);
  assert.equal(parseClp('50'), null, 'demasiado barato para ser CLP real');
  assert.equal(parseClp('999999999999'), null, 'fuera de rango');
});

test('discountPercent solo reporta rebajas reales', () => {
  assert.equal(discountPercent(80000, 100000), 20);
  assert.equal(discountPercent(100000, 100000), null, 'mismo precio no es oferta');
  assert.equal(discountPercent(100000, 90000), null, 'precio normal menor se ignora');
  assert.equal(discountPercent(100000, null), null);
});

test('changePercent calcula la variacion con signo', () => {
  assert.equal(changePercent(90000, 100000), -10);
  assert.equal(changePercent(110000, 100000), 10);
  assert.equal(changePercent(100000, 0), null);
});
