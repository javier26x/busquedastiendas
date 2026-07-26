import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FILTERS,
  computeStats,
  filterProducts,
  sortProducts,
  storeOptions,
} from '../src/lib/sort.js';
import type { Product } from '../src/types.js';

function product(overrides: Partial<Product> = {}): Product {
  return {
    key: 'easy__sku',
    storeId: 'easy',
    storeLabel: 'Easy',
    externalId: 'sku',
    searchIds: ['cajas-organizadoras'],
    title: 'Caja organizadora 60L',
    url: 'https://x/1',
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
    lastSeenAt: new Date('2026-07-20'),
    ...overrides,
  };
}

const cheap = product({ key: 'a', price: 5000 });
const mid = product({ key: 'b', price: 10000, priceChange: -2000, priceChangePct: -16.7 });
const expensive = product({ key: 'c', price: 20000, priceChange: 1000, priceChangePct: 5.3 });

test('ordena por precio en ambas direcciones', () => {
  const asc = sortProducts([expensive, cheap, mid], 'precio-asc');
  assert.deepEqual(asc.map((p) => p.key), ['a', 'b', 'c']);

  const desc = sortProducts([cheap, expensive, mid], 'precio-desc');
  assert.deepEqual(desc.map((p) => p.key), ['c', 'b', 'a']);
});

test('"mayores bajas" pone primero la caida mas grande', () => {
  const sorted = sortProducts([cheap, expensive, mid], 'variacion-baja');
  assert.equal(sorted[0]?.key, 'b', 'el que bajo -16,7% va primero');
  assert.equal(sorted[1]?.key, 'c', 'luego el que subio');
  assert.equal(sorted[2]?.key, 'a', 'los sin variacion quedan al final');
});

test('"mayores alzas" invierte el criterio pero mantiene los nulos al final', () => {
  const sorted = sortProducts([cheap, mid, expensive], 'variacion-alza');
  assert.equal(sorted[0]?.key, 'c');
  assert.equal(sorted[1]?.key, 'b');
  assert.equal(sorted[2]?.key, 'a', 'sin variacion nunca encabeza');
});

test('ordenar por oferta pone las ofertas arriba y luego por descuento', () => {
  const sinOferta = product({ key: 'n', price: 1000 });
  const oferta10 = product({ key: 'o10', price: 9000, isOffer: true, discountPct: 10 });
  const oferta40 = product({ key: 'o40', price: 9500, isOffer: true, discountPct: 40 });

  const sorted = sortProducts([sinOferta, oferta10, oferta40], 'oferta');
  assert.deepEqual(sorted.map((p) => p.key), ['o40', 'o10', 'n']);
});

test('ordenar por descuento deja los productos sin descuento al final', () => {
  const sinDescuento = product({ key: 'n' });
  const conDescuento = product({ key: 'd', discountPct: 25 });

  const sorted = sortProducts([sinDescuento, conDescuento], 'descuento-desc');
  assert.deepEqual(sorted.map((p) => p.key), ['d', 'n']);
});

test('el orden no muta el arreglo original', () => {
  const original = [expensive, cheap];
  const copy = [...original];
  sortProducts(original, 'precio-asc');
  assert.deepEqual(original, copy);
});

test('filtra por busqueda, tienda y texto', () => {
  const bodega = product({
    key: 'bod',
    searchIds: ['bodegas-jardin'],
    storeId: 'sodimac',
    storeLabel: 'Sodimac',
    title: 'Bodega de jardin PVC',
    brand: 'Keter',
  });
  const caja = product({ key: 'caja' });
  const all = [bodega, caja];

  assert.deepEqual(
    filterProducts(all, { ...DEFAULT_FILTERS, searchId: 'bodegas-jardin' }).map((p) => p.key),
    ['bod'],
  );
  assert.deepEqual(
    filterProducts(all, { ...DEFAULT_FILTERS, storeIds: ['easy'] }).map((p) => p.key),
    ['caja'],
  );
  assert.deepEqual(
    filterProducts(all, { ...DEFAULT_FILTERS, query: 'keter' }).map((p) => p.key),
    ['bod'],
    'el texto tambien busca en la marca',
  );
});

test('el filtro de texto ignora tildes y mayusculas', () => {
  const items = [product({ key: 'a', title: 'Bodega de jardín metálica' })];

  assert.equal(filterProducts(items, { ...DEFAULT_FILTERS, query: 'JARDIN' }).length, 1);
  assert.equal(filterProducts(items, { ...DEFAULT_FILTERS, query: 'metalica' }).length, 1);
});

test('los filtros de ofertas, bajadas y stock se combinan', () => {
  const items = [
    product({ key: 'oferta-baja', isOffer: true, priceChange: -1000 }),
    product({ key: 'oferta-alza', isOffer: true, priceChange: 500 }),
    product({ key: 'sin-stock', isOffer: true, priceChange: -500, available: false }),
  ];

  const result = filterProducts(items, {
    ...DEFAULT_FILTERS,
    onlyOffers: true,
    onlyDrops: true,
    onlyAvailable: true,
  });

  assert.deepEqual(result.map((p) => p.key), ['oferta-baja']);
});

test('computeStats resume ofertas, bajas, alzas y extremos', () => {
  const stats = computeStats([cheap, mid, expensive, product({ key: 'of', isOffer: true })]);

  assert.equal(stats.total, 4);
  assert.equal(stats.offers, 1);
  assert.equal(stats.drops, 1);
  assert.equal(stats.rises, 1);
  assert.equal(stats.cheapest?.key, 'a');
  assert.equal(stats.biggestDrop?.key, 'b');
});

test('storeOptions cuenta productos por tienda y ordena alfabeticamente', () => {
  const options = storeOptions([
    product({ storeId: 'sodimac', storeLabel: 'Sodimac' }),
    product({ storeId: 'easy', storeLabel: 'Easy' }),
    product({ storeId: 'easy', storeLabel: 'Easy' }),
  ]);

  assert.deepEqual(options, [
    { id: 'easy', label: 'Easy', count: 2 },
    { id: 'sodimac', label: 'Sodimac', count: 1 },
  ]);
});
