import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveMatchRules,
  parseQueries,
  rulesToText,
  significantWords,
  stem,
  textToRules,
  toSearchId,
  validateDraft,
  type SearchDraft,
} from '../src/lib/searchRules.js';

test('stem recorta plurales para que el singular tambien calce', () => {
  assert.equal(stem('pañales'), 'panal');
  assert.equal(stem('cajas'), 'caja');
  assert.equal(stem('organizadoras'), 'organizadora');
  assert.equal(stem('lapices'), 'lapiz');
});

test('stem deja intactas las palabras cortas', () => {
  assert.equal(stem('gas'), 'gas', 'quitar la s la volveria inutil');
  assert.equal(stem('tres'), 'tres');
});

test('significantWords descarta preposiciones y articulos', () => {
  assert.deepEqual(significantWords('Bodega de jardín para el patio'), [
    'bodega',
    'jardin',
    'patio',
  ]);
});

test('significantWords no repite palabras', () => {
  assert.deepEqual(significantWords('caja caja organizadora'), ['caja', 'organizadora']);
});

test('deriveMatchRules exige la raiz de cada palabra del nombre', () => {
  assert.deepEqual(deriveMatchRules('Pañales'), {
    requireAll: [['panal']],
    exclude: [],
  });

  assert.deepEqual(deriveMatchRules('Zapatillas running'), {
    requireAll: [['zapatilla'], ['running']],
    exclude: [],
  });
});

test('deriveMatchRules tolera un nombre sin palabras utiles', () => {
  assert.deepEqual(deriveMatchRules('de la'), { requireAll: [], exclude: [] });
});

test('toSearchId produce identificadores estables y seguros', () => {
  assert.equal(toSearchId('Pañales talla G'), 'panales-talla-g');
  assert.equal(toSearchId('Bodegas de jardín'), 'bodegas-de-jardin');
  assert.ok(!toSearchId('a/b/c').includes('/'), 'sin barras que rompan la ruta');
  assert.ok(toSearchId('!!!').length > 0, 'nunca vacio');
});

test('las reglas van y vuelven del formato de texto sin perderse', () => {
  const rules = { requireAll: [['bodega', 'caseta'], ['jardin']], exclude: ['vino', 'juguete'] };
  const back = textToRules(rulesToText(rules), rules.exclude.join(', '));

  assert.deepEqual(back, rules);
});

test('textToRules ignora lineas y comas vacias', () => {
  const rules = textToRules('bodega,  , caseta\n\n  \njardin', 'vino, , \n juguete');

  assert.deepEqual(rules.requireAll, [['bodega', 'caseta'], ['jardin']]);
  assert.deepEqual(rules.exclude, ['vino', 'juguete']);
});

test('parseQueries limpia, deduplica y respeta el orden', () => {
  assert.deepEqual(parseQueries('  pañales \n\npañales talla g\n pañales \n'), [
    'pañales',
    'pañales talla g',
  ]);
});

function draft(overrides: Partial<SearchDraft> = {}): SearchDraft {
  return {
    id: 'panales',
    label: 'Pañales',
    queries: ['pañales'],
    match: { requireAll: [['panal']], exclude: [] },
    enabled: true,
    ...overrides,
  };
}

test('validateDraft acepta una busqueda razonable', () => {
  assert.equal(validateDraft(draft()).ok, true);
});

test('validateDraft exige nombre y al menos un termino', () => {
  assert.deepEqual(validateDraft(draft({ label: '  ' })).ok, false);
  assert.deepEqual(validateDraft(draft({ queries: [] })).ok, false);
});

test('validateDraft pone techo a los terminos, porque cada uno cuesta una consulta por tienda', () => {
  const many = Array.from({ length: 11 }, (_v, i) => `termino ${i}`);
  const result = validateDraft(draft({ queries: many }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('Maximo 10 terminos')));
});
