import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FILTERS,
  computeStats,
  filterProducts,
  isAtHistoricLow,
  sortProducts,
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

test('esta en su minimo si hoy paga lo mas bajo que se le ha visto', () => {
  const p = product({ price: 8000, minPrice: 8000, maxPrice: 12000 });
  assert.equal(isAtHistoricLow(p), true);
});

test('no lo esta si alguna vez estuvo mas barato', () => {
  const p = product({ price: 9000, minPrice: 8000, maxPrice: 12000 });
  assert.equal(isAtHistoricLow(p), false);
});

test('un producto que nunca cambio de precio no cuenta como minimo', () => {
  // Si contara, el primer dia todo el catalogo apareceria marcado y la
  // senal no distinguiria nada.
  const p = product({ price: 10000, minPrice: 10000, maxPrice: 10000 });
  assert.equal(isAtHistoricLow(p), false);
});

test('un precio por debajo del minimo conocido tambien cuenta', () => {
  // Pasa entre que el scraper lee el precio nuevo y recalcula `minPrice`.
  const p = product({ price: 7000, minPrice: 8000, maxPrice: 12000 });
  assert.equal(isAtHistoricLow(p), true);
});

test('el filtro deja solo los que estan en su minimo', () => {
  const enMinimo = product({ key: 'a', price: 8000, minPrice: 8000, maxPrice: 12000 });
  const arriba = product({ key: 'b', price: 11000, minPrice: 8000, maxPrice: 12000 });

  const filtrados = filterProducts([enMinimo, arriba], {
    ...DEFAULT_FILTERS,
    onlyHistoricLows: true,
  });

  assert.deepEqual(
    filtrados.map((p) => p.key),
    ['a'],
  );
});

test('computeStats cuenta cuantos estan en su minimo', () => {
  const stats = computeStats([
    product({ key: 'a', price: 8000, minPrice: 8000, maxPrice: 12000 }),
    product({ key: 'b', price: 11000, minPrice: 8000, maxPrice: 12000 }),
    product({ key: 'c', price: 5000, minPrice: 5000, maxPrice: 9000 }),
  ]);

  assert.equal(stats.historicLows, 2);
});

test('el orden pone arriba los que estan en su minimo', () => {
  const arriba = product({ key: 'arriba', price: 11000, minPrice: 8000, maxPrice: 12000 });
  const enMinimo = product({ key: 'minimo', price: 8000, minPrice: 8000, maxPrice: 12000 });

  const ordenados = sortProducts([arriba, enMinimo], 'minimo-historico');

  assert.deepEqual(
    ordenados.map((p) => p.key),
    ['minimo', 'arriba'],
  );
});

test('entre los que estan en su minimo, primero el que mas cayo desde su techo', () => {
  // Mas barato no es lo mismo que mejor ocasion: el de $8.000 venia de
  // $40.000 y el de $5.000 apenas bajo de $6.000.
  const granCaida = product({ key: 'caida', price: 8000, minPrice: 8000, maxPrice: 40000 });
  const caidaChica = product({ key: 'chica', price: 5000, minPrice: 5000, maxPrice: 6000 });

  const ordenados = sortProducts([caidaChica, granCaida], 'minimo-historico');

  assert.deepEqual(
    ordenados.map((p) => p.key),
    ['caida', 'chica'],
  );
});

test('el orden no muta el arreglo original', () => {
  const lista = [
    product({ key: 'a', price: 11000, minPrice: 8000, maxPrice: 12000 }),
    product({ key: 'b', price: 8000, minPrice: 8000, maxPrice: 12000 }),
  ];

  sortProducts(lista, 'minimo-historico');

  assert.deepEqual(
    lista.map((p) => p.key),
    ['a', 'b'],
  );
});
