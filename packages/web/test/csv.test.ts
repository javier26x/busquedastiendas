import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvFilename, toCsv } from '../src/lib/csv.js';
import type { Product } from '../src/types.js';

function product(overrides: Partial<Product> = {}): Product {
  return {
    key: 'easy__sku',
    storeId: 'easy',
    storeLabel: 'Easy',
    externalId: 'sku',
    searchIds: ['cajas-organizadoras'],
    title: 'Caja organizadora 60L',
    url: 'https://easy.cl/p/1',
    image: null,
    brand: 'Wenco',
    currency: 'CLP',
    available: true,
    price: 10000,
    listPrice: null,
    isOffer: false,
    discountPct: null,
    previousPrice: null,
    priceChange: null,
    priceChangePct: null,
    priceChangedAt: null,
    minPrice: 10000,
    maxPrice: 10000,
    firstSeenAt: new Date('2026-07-01'),
    lastSeenAt: new Date('2026-07-20T12:00:00Z'),
    ...overrides,
  };
}

function rows(csv: string): string[][] {
  return csv.split('\r\n').map((line) => line.split(';'));
}

test('la primera fila son los encabezados', () => {
  const [header] = rows(toCsv([]));

  assert.equal(header?.[0], 'Tienda');
  assert.equal(header?.[1], 'Producto');
  assert.ok(header?.includes('URL'));
});

test('exporta una fila por producto', () => {
  const csv = toCsv([product({ key: 'a' }), product({ key: 'b' })]);
  assert.equal(rows(csv).length, 3);
});

test('un titulo con punto y coma no rompe las columnas', () => {
  // Sin entrecomillar, el titulo se partiria en dos celdas y correria todo
  // el resto de la fila una columna a la derecha.
  const csv = toCsv([product({ title: 'Caja 60L; con tapa' })]);
  const fila = csv.split('\r\n')[1] ?? '';

  assert.ok(fila.includes('"Caja 60L; con tapa"'));
  assert.equal(rows(toCsv([]))[0]?.length, fila.split(';').length - 1);
});

test('las comillas del titulo se duplican, como manda el formato', () => {
  const csv = toCsv([product({ title: 'Caja 24" transparente' })]);
  assert.ok(csv.includes('"Caja 24"" transparente"'));
});

test('los decimales van con coma, que es lo que lee Excel en español', () => {
  const csv = toCsv([product({ priceChangePct: -16.7 })]);
  assert.ok(csv.includes('-16,7'));
});

test('un campo vacio queda vacio y no como "null"', () => {
  const csv = toCsv([product({ brand: null, listPrice: null })]);
  assert.equal(csv.includes('null'), false);
});

test('marca si el producto esta en su minimo historico', () => {
  const enMinimo = toCsv([product({ price: 8000, minPrice: 8000, maxPrice: 12000 })]);
  const arriba = toCsv([product({ price: 11000, minPrice: 8000, maxPrice: 12000 })]);

  const columna = rows(toCsv([]))[0]?.indexOf('En su minimo') ?? -1;
  assert.notEqual(columna, -1);
  assert.equal(rows(enMinimo)[1]?.[columna], 'si');
  assert.equal(rows(arriba)[1]?.[columna], 'no');
});

test('el nombre del archivo lleva la busqueda y la fecha', () => {
  const nombre = csvFilename('Bodegas de jardín', new Date('2026-09-12T10:00:00Z'));
  assert.equal(nombre, 'precios-bodegas-de-jardin-2026-09-12.csv');
});

test('sin busqueda activa el archivo se llama "todas"', () => {
  assert.equal(csvFilename(null, new Date('2026-09-12T10:00:00Z')), 'precios-todas-2026-09-12.csv');
});

test('un nombre que se queda sin letras no deja el archivo sin identificar', () => {
  assert.equal(csvFilename('???', new Date('2026-09-12T10:00:00Z')), 'precios-todas-2026-09-12.csv');
});
