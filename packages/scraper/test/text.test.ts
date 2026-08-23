import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesRules, normalizeText, slugify, absoluteUrl } from '../src/lib/text.js';
import { getSearch } from '../src/config/searches.js';

test('normalizeText quita tildes y normaliza espacios', () => {
  assert.equal(normalizeText('  Bodega  de JARDÍN '), 'bodega de jardin');
  assert.equal(normalizeText('Organización'), 'organizacion');
});

test('slugify produce claves seguras para Firestore', () => {
  assert.equal(slugify('MLC-123 456'), 'mlc-123-456');
  assert.equal(slugify('///'), 'x', 'nunca devuelve vacio');
  assert.ok(!slugify('a/b/c').includes('/'), 'sin barras que rompan las rutas');
});

test('dos textos largos con el mismo prefijo no comparten clave', () => {
  // Pasa con las URL de IKEA: se diferencian solo al final. Si el recorte las
  // iguala, dos productos comparten documento y se pisan el precio.
  const prefix = '/cl/es/p/'.padEnd(150, 'a');
  const uno = slugify(`${prefix}-bestaa-40556123`);
  const dos = slugify(`${prefix}-bestaa-40556124`);

  assert.notEqual(uno, dos);
  assert.ok(uno.length <= 120, 'sigue siendo una clave manejable');
  assert.equal(uno, slugify(`${prefix}-bestaa-40556123`), 'y es estable entre corridas');
});

test('el filtro de bodegas de jardin descarta bodegas de vino y bodegaje', () => {
  const search = getSearch('bodegas-jardin');
  assert.ok(search);

  assert.ok(matchesRules('Bodega de jardín PVC 4x6 exterior', search.match));
  assert.ok(matchesRules('Caseta jardin madera tratada terraza', search.match));

  assert.ok(!matchesRules('Bodega de vinos 24 botellas', search.match));
  assert.ok(!matchesRules('Servicio de bodegaje mensual', search.match));
  assert.ok(!matchesRules('Set de herramientas para jardin', search.match), 'sin "bodega" no aplica');
});

test('el filtro de Rexona Clinical atrapa el spray y descarta el ruido', () => {
  const search = getSearch('rexona-clinical');
  assert.ok(search);

  // El del screenshot y variantes que deberian entrar.
  assert.ok(matchesRules('Desodorante Spray Rexona Men Clinical Pack 2X Hombre, 300 ml', search.match));
  assert.ok(matchesRules('Rexona Clinical Roll On Antitranspirante 50 ml', search.match));

  // Otros Rexona que no son la linea Clinical, y otros "clinical" que no son Rexona.
  assert.ok(!matchesRules('Desodorante Rexona Men Xtra Cool 150 ml', search.match), 'sin "clinical" no aplica');
  assert.ok(!matchesRules('Desodorante Dove Clinical Original 48h', search.match), 'sin "rexona" no aplica');
  assert.ok(!matchesRules('Neceser Rexona Clinical de regalo', search.match), 'un neceser no es el producto');
});

test('el filtro de cajas organizadoras descarta cajas fuertes y de herramientas', () => {
  const search = getSearch('cajas-organizadoras');
  assert.ok(search);

  assert.ok(matchesRules('Caja organizadora plástica 60L con tapa', search.match));
  assert.ok(matchesRules('Set 3 cajas organizadoras apilables', search.match));

  assert.ok(!matchesRules('Caja fuerte digital 20L', search.match));
  assert.ok(!matchesRules('Caja de herramientas metálica', search.match));
  assert.ok(!matchesRules('Organizador de cables escritorio', search.match));
});

test('absoluteUrl resuelve relativas y descarta invalidas', () => {
  assert.equal(
    absoluteUrl('/producto/123', 'https://www.easy.cl'),
    'https://www.easy.cl/producto/123',
  );
  assert.equal(absoluteUrl('https://otra.cl/x', 'https://www.easy.cl'), 'https://otra.cl/x');
  assert.equal(absoluteUrl(null, 'https://www.easy.cl'), null);
});
