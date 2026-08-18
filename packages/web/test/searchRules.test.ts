import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveMatchRules,
  deserializeMatchRules,
  serializeMatchRules,
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

test('significantWords prefiere las palabras vacias antes que no devolver nada', () => {
  // Quedarse sin palabras deja la busqueda sin filtro y entra todo el catalogo.
  assert.deepEqual(significantWords('de la'), ['de', 'la']);
  assert.deepEqual(significantWords('!!!'), []);
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
  assert.deepEqual(deriveMatchRules('de la'), { requireAll: [['de'], ['la']], exclude: [] });
  assert.deepEqual(deriveMatchRules('!!!'), { requireAll: [], exclude: [] });
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

test('validateDraft rechaza una busqueda sin palabras obligatorias', () => {
  const result = validateDraft(draft({ match: { requireAll: [], exclude: [] } }));

  assert.equal(result.ok, false, 'sin filtro entraria todo el catalogo de cada tienda');
});

test('validateDraft pone techo a los terminos, porque cada uno cuesta una consulta por tienda', () => {
  const many = Array.from({ length: 11 }, (_v, i) => `termino ${i}`);
  const result = validateDraft(draft({ queries: many }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('Maximo 10 terminos')));
});

test('las reglas se guardan sin arreglos anidados: Firestore los rechaza', () => {
  const rules = { requireAll: [['bodega', 'caseta'], ['jardin']], exclude: ['vino'] };
  const stored = serializeMatchRules(rules);

  assert.deepEqual(stored, {
    requireAll: [{ anyOf: ['bodega', 'caseta'] }, { anyOf: ['jardin'] }],
    exclude: ['vino'],
  });

  // La comprobacion que importa: ningun elemento de un arreglo es otro arreglo.
  for (const group of stored.requireAll) {
    assert.ok(!Array.isArray(group), 'requireAll no puede contener arreglos');
  }
});

test('serializar y deserializar deja las reglas igual', () => {
  const rules = { requireAll: [['bodega', 'caseta'], ['jardin']], exclude: ['vino', 'juguete'] };

  assert.deepEqual(deserializeMatchRules(serializeMatchRules(rules)), rules);
});

test('deserializeMatchRules acepta la forma anidada de la version anterior', () => {
  const legacy = { requireAll: [['bodega'], ['jardin']], exclude: ['vino'] };

  assert.deepEqual(deserializeMatchRules(legacy), {
    requireAll: [['bodega'], ['jardin']],
    exclude: ['vino'],
  });
});

test('deserializeMatchRules tolera documentos sin match o con basura', () => {
  const vacio = { requireAll: [], exclude: [] };

  assert.deepEqual(deserializeMatchRules(undefined), vacio);
  assert.deepEqual(deserializeMatchRules(null), vacio);
  assert.deepEqual(deserializeMatchRules('texto'), vacio);
  assert.deepEqual(deserializeMatchRules({ requireAll: [{}, { anyOf: [] }, 3], exclude: [7] }), vacio);
});
