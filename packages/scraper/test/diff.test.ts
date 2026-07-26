import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord } from '../src/pipeline/diff.js';
import { mergeOffers, normalizeOffers, productKey } from '../src/pipeline/normalize.js';
import { getSearch } from '../src/config/searches.js';
import type { NormalizedOffer, ProductRecord, RawOffer, StoreAdapter } from '../src/types.js';

const T0 = new Date('2026-07-01T10:00:00Z');
const T1 = new Date('2026-07-02T10:00:00Z');
const T2 = new Date('2026-07-03T10:00:00Z');

function offer(overrides: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    externalId: 'SKU1',
    title: 'Caja organizadora 60L con tapa',
    url: 'https://www.easy.cl/p/1',
    image: null,
    brand: 'Wenco',
    price: 10000,
    listPrice: null,
    currency: 'CLP',
    available: true,
    storeId: 'easy',
    storeLabel: 'Easy',
    searchIds: ['cajas-organizadoras'],
    key: productKey('easy', 'SKU1'),
    isOffer: false,
    discountPct: null,
    ...overrides,
  };
}

test('un producto nuevo se crea sin variacion y con historial inicial', () => {
  const { record, history, kind } = buildRecord(null, offer(), T0, 'run-1');

  assert.equal(kind, 'created');
  assert.equal(record.price, 10000);
  assert.equal(record.previousPrice, null);
  assert.equal(record.priceChange, null);
  assert.equal(record.minPrice, 10000);
  assert.equal(record.maxPrice, 10000);
  assert.deepEqual(record.firstSeenAt, T0);
  assert.ok(history, 'el primer avistamiento entra al historial');
});

test('una baja de precio registra variacion negativa y mueve el minimo', () => {
  const first = buildRecord(null, offer(), T0, 'run-1').record;
  const { record, history, kind } = buildRecord(first, offer({ price: 8000 }), T1, 'run-2');

  assert.equal(kind, 'drop');
  assert.equal(record.previousPrice, 10000);
  assert.equal(record.priceChange, -2000);
  assert.equal(record.priceChangePct, -20);
  assert.deepEqual(record.priceChangedAt, T1);
  assert.equal(record.minPrice, 8000);
  assert.equal(record.maxPrice, 10000);
  assert.deepEqual(record.firstSeenAt, T0, 'firstSeenAt no se pisa');
  assert.ok(history);
});

test('un alza de precio se clasifica como rise', () => {
  const first = buildRecord(null, offer(), T0, 'run-1').record;
  const { record, kind } = buildRecord(first, offer({ price: 12500 }), T1, 'run-2');

  assert.equal(kind, 'rise');
  assert.equal(record.priceChange, 2500);
  assert.equal(record.priceChangePct, 25);
  assert.equal(record.maxPrice, 12500);
});

test('si el precio no cambia se conserva la ultima variacion conocida', () => {
  const first = buildRecord(null, offer(), T0, 'run-1').record;
  const dropped = buildRecord(first, offer({ price: 8000 }), T1, 'run-2').record;
  const { record, history, kind } = buildRecord(dropped, offer({ price: 8000 }), T2, 'run-3');

  assert.equal(kind, 'unchanged');
  assert.equal(history, null, 'no se escribe historial redundante');
  assert.equal(record.previousPrice, 10000, 'sigue apuntando al ultimo precio distinto');
  assert.equal(record.priceChange, -2000);
  assert.deepEqual(record.priceChangedAt, T1, 'la fecha del cambio no se corre');
  assert.deepEqual(record.lastSeenAt, T2, 'pero si se actualiza lastSeenAt');
});

test('las busquedas se acumulan cuando un producto aparece en ambas', () => {
  const first = buildRecord(null, offer(), T0, 'run-1').record;
  const { record } = buildRecord(
    first,
    offer({ searchIds: ['bodegas-jardin'] }),
    T1,
    'run-2',
  );

  assert.deepEqual(record.searchIds, ['bodegas-jardin', 'cajas-organizadoras']);
});

test('normalizeOffers filtra lo irrelevante y marca las ofertas', () => {
  const search = getSearch('cajas-organizadoras');
  assert.ok(search);

  const adapter = { id: 'easy', label: 'Easy' } as StoreAdapter;
  const raw: RawOffer[] = [
    {
      externalId: 'A',
      title: 'Caja organizadora 60L con tapa',
      url: 'https://x/1',
      image: null,
      brand: null,
      price: 8000,
      listPrice: 10000,
      currency: 'CLP',
      available: true,
    },
    {
      externalId: 'B',
      title: 'Caja fuerte digital',
      url: 'https://x/2',
      image: null,
      brand: null,
      price: 50000,
      listPrice: null,
      currency: 'CLP',
      available: true,
    },
  ];

  const result = normalizeOffers(adapter, search, raw);

  assert.equal(result.length, 1, 'la caja fuerte se descarta');
  assert.equal(result[0]?.externalId, 'A');
  assert.equal(result[0]?.isOffer, true);
  assert.equal(result[0]?.discountPct, 20);
});

test('normalizeOffers ignora un precio normal menor o igual al vigente', () => {
  const search = getSearch('cajas-organizadoras');
  assert.ok(search);

  const result = normalizeOffers({ id: 'easy', label: 'Easy' } as StoreAdapter, search, [
    {
      externalId: 'A',
      title: 'Caja organizadora 60L con tapa',
      url: 'https://x/1',
      image: null,
      brand: null,
      price: 10000,
      listPrice: 10000,
      currency: 'CLP',
      available: true,
    },
  ]);

  assert.equal(result[0]?.listPrice, null);
  assert.equal(result[0]?.isOffer, false);
});

test('mergeOffers deduplica quedandose con el precio menor y todas las busquedas', () => {
  const merged = mergeOffers([
    offer({ price: 10000, searchIds: ['cajas-organizadoras'] }),
    offer({ price: 9000, searchIds: ['bodegas-jardin'] }),
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.price, 9000);
  assert.deepEqual([...(merged[0]?.searchIds ?? [])].sort(), [
    'bodegas-jardin',
    'cajas-organizadoras',
  ]);
});

test('productos de distintas tiendas no colisionan', () => {
  const merged = mergeOffers([
    offer({ storeId: 'easy', key: productKey('easy', 'SKU1') }),
    offer({ storeId: 'sodimac', key: productKey('sodimac', 'SKU1') }),
  ]);

  assert.equal(merged.length, 2);
});

test('el registro persistido conserva la tienda declarada por la oferta', () => {
  const record: ProductRecord = buildRecord(
    null,
    offer({ storeId: 'paris', storeLabel: 'Paris' }),
    T0,
    'run-1',
  ).record;

  assert.equal(record.storeId, 'paris');
  assert.equal(record.storeLabel, 'Paris');
});
