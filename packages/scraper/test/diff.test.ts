import { test } from 'node:test';
import * as cheerio from 'cheerio';
import { extractStructuredOffers } from '../src/adapters/html-search.js';
import { extractDomCards, extractPrices } from '../src/adapters/dom-cards.js';
import assert from 'node:assert/strict';
import { buildRecord } from '../src/pipeline/diff.js';
import { mergeOffers, normalizeOffers, productKey } from '../src/pipeline/normalize.js';
import { getSearch } from '../src/config/searches.js';
import { parseSearchDoc, parseMatchRules, serializeMatchRules } from '../src/firestore/searches.js';
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

test('el scraper lee las reglas guardadas como { anyOf }, sin arreglos anidados', () => {
  const stored = {
    label: 'Panales',
    queries: ['panales'],
    match: {
      requireAll: [{ anyOf: ['panal'] }, { anyOf: ['talla', 'pack'] }],
      exclude: ['juguete'],
    },
    enabled: true,
  };

  const parsed = parseSearchDoc('panales', stored);

  assert.ok(parsed);
  assert.deepEqual(parsed.match.requireAll, [['panal'], ['talla', 'pack']]);
  assert.deepEqual(parsed.match.exclude, ['juguete']);
});

test('parseSearchDoc descarta documentos sin terminos, que no se pueden consultar', () => {
  assert.equal(parseSearchDoc('x', { label: 'X', queries: [] }), null);
  assert.equal(parseSearchDoc('x', { label: 'X' }), null);
});

test('parseSearchDoc sobrevive a un match ausente o malformado', () => {
  const parsed = parseSearchDoc('x', { label: 'X', queries: ['algo'], match: 'basura' });

  assert.ok(parsed);
  assert.deepEqual(parsed.match, { requireAll: [], exclude: [] });
});

test('las reglas del codigo se serializan sin arreglos anidados', () => {
  const search = getSearch('bodegas-jardin');
  assert.ok(search);

  const stored = serializeMatchRules(search.match) as { requireAll: unknown[] };

  for (const group of stored.requireAll) {
    assert.ok(!Array.isArray(group), 'Firestore rechazaria un arreglo dentro de otro');
  }
  // Y el scraper vuelve a leer exactamente lo mismo.
  assert.deepEqual(parseMatchRules(stored).requireAll, search.match.requireAll);
});

test('Sodimac: sin campo url no se extrae nada, con buildProductUrl si', () => {
  // Producto tal como lo publica Sodimac en __NEXT_DATA__: no trae `url`.
  const producto = {
    productId: '3354652',
    skuId: '3354652',
    displayName: 'Caja Organizadora 30x40x25 cm Beige',
    brand: 'Just Home Collection',
    prices: [{ type: 'NORMAL', symbol: '$', price: '7.990', priceWithoutFormatting: 7990 }],
    mediaUrls: ['https://media.falabella.com/sodimacCL/3354652/public'],
  };
  const state = { props: { pageProps: { searchProps: { searchData: { results: [producto] } } } } };
  const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    state,
  )}</script></body></html>`;

  const sinUrl = extractStructuredOffers(cheerio.load(html), 'https://www.sodimac.cl');
  assert.equal(sinUrl.length, 0, 'sin enlace no hay oferta utilizable');

  const conUrl = extractStructuredOffers(cheerio.load(html), 'https://www.sodimac.cl', {
    buildProductUrl: (node) =>
      typeof node['productId'] === 'string'
        ? `https://www.sodimac.cl/sodimac-cl/product/${node['productId']}/`
        : null,
  });

  assert.equal(conUrl.length, 1);
  assert.equal(conUrl[0]?.title, 'Caja Organizadora 30x40x25 cm Beige');
  assert.equal(conUrl[0]?.price, 7990);
  assert.equal(conUrl[0]?.brand, 'Just Home Collection');
  assert.equal(conUrl[0]?.url, 'https://www.sodimac.cl/sodimac-cl/product/3354652/');
});

test('se prefiere priceWithoutFormatting al precio con separadores', () => {
  // Si se leyera "1.234.567" mal, el separador de miles daria otro numero.
  const producto = {
    productId: 'X',
    displayName: 'Bodega de jardin grande exterior',
    prices: [{ price: '1.234.567', priceWithoutFormatting: 1234567 }],
  };
  const state = { props: { results: [producto] } };
  const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    state,
  )}</script></body></html>`;

  const offers = extractStructuredOffers(cheerio.load(html), 'https://x.cl', {
    buildProductUrl: () => 'https://x.cl/p/1',
  });

  assert.equal(offers[0]?.price, 1234567);
});

test('con varios precios, el menor es el vigente y el mayor el normal', () => {
  const producto = {
    productId: 'X',
    displayName: 'Caja organizadora con tapa apilable',
    prices: [
      { type: 'NORMAL', priceWithoutFormatting: 19990 },
      { type: 'INTERNET', priceWithoutFormatting: 12990 },
    ],
  };
  const state = { props: { results: [producto] } };
  const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    state,
  )}</script></body></html>`;

  const offers = extractStructuredOffers(cheerio.load(html), 'https://x.cl', {
    buildProductUrl: () => 'https://x.cl/p/1',
  });

  assert.equal(offers[0]?.price, 12990);
  assert.equal(offers[0]?.listPrice, 19990);
});

test('el id de un producto usa la ruta completa, no el ultimo segmento', () => {
  // Paris y las tiendas VTEX terminan sus URL en "/p": tomar el ultimo
  // segmento daria el mismo id a todos y colapsarian al deduplicar.
  const html = (n: number): string => `
    <div data-testid="pod">
      <a href="/producto/caja-organizadora-${n}/p">Caja organizadora ${n} litros con tapa</a>
      <span class="price">$${10 + n}.990</span>
    </div>`;

  const $ = cheerio.load(`<html><body>${html(1)}${html(2)}${html(3)}</body></html>`);
  const offers = extractDomCards($, 'https://www.paris.cl', ['[data-testid="pod"]']);

  assert.equal(offers.length, 3, 'los tres productos deben sobrevivir a la deduplicacion');
  assert.equal(new Set(offers.map((o) => o.externalId)).size, 3, 'con ids distintos');
});

test('las tarjetas del DOM toman el menor precio como vigente y el mayor como normal', () => {
  const $ = cheerio.load(`
    <div data-testid="pod">
      <a href="/producto/x/p">Caja organizadora grande con tapa</a>
      <span class="price">$19.990</span>
      <span class="price">$12.990</span>
    </div>`);

  const offers = extractDomCards($, 'https://www.paris.cl', ['[data-testid="pod"]']);

  assert.equal(offers[0]?.price, 12990);
  assert.equal(offers[0]?.listPrice, 19990);
});

test('dos precios en un mismo nodo no se leen como una sola cifra', () => {
  // Sintoma real en IKEA: "$3.990" junto a "$3.990" daba $39.903.990.
  assert.deepEqual(extractPrices('$3.990$3.990'), [3990, 3990]);
  assert.deepEqual(extractPrices('$12.990 $19.990'), [12990, 19990]);
});

test('extractPrices tolera nodos con solo la cifra', () => {
  assert.deepEqual(extractPrices('12.990'), [12990]);
  assert.deepEqual(extractPrices('sin stock'), []);
});

test('un contenedor con precios anidados no duplica ni concatena', () => {
  // El padre lleva class="prices" y sus hijos los importes: si se leyera el
  // texto del padre saldria "3.9905.990" -> 39.905.990.
  const $ = cheerio.load(`
    <div data-testid="pod">
      <a href="/producto/caja-organizadora/p">Caja organizadora con tapa 30 litros</a>
      <div class="prices">
        <span class="price">$3.990</span>
        <span class="price-normal">$5.990</span>
      </div>
    </div>`);

  const offers = extractDomCards($, 'https://x.cl', ['[data-testid="pod"]']);

  assert.equal(offers[0]?.price, 3990);
  assert.equal(offers[0]?.listPrice, 5990);
});

test('las medidas del producto no se leen como precio', () => {
  // Sintoma real en IKEA: "26x35x15 cm" daba un precio normal de $263.515.
  assert.deepEqual(extractPrices('SOCKERBIT Caja con tapa, blanco, 38x51x30 cm'), []);
  assert.deepEqual(extractPrices('26x35x15 cm'), []);
  assert.deepEqual(extractPrices('39x28x14 cm/11 l'), []);
  assert.deepEqual(extractPrices('11 l'), []);
});

test('un nodo con solo la cifra si cuenta como precio', () => {
  assert.deepEqual(extractPrices('3.990'), [3990]);
  assert.deepEqual(extractPrices(' $ 1.990 '), [1990]);
});

test('un descuento imposible se descarta en vez de mostrarse', () => {
  // Un precio normal 10 veces mayor no es una oferta: es un precio mal leido.
  const $ = cheerio.load(`
    <div data-testid="pod">
      <a href="/producto/caja/p">Caja organizadora con tapa transparente</a>
      <span class="price">$3.990</span>
      <span class="price-x">$385.130</span>
    </div>`);

  const offers = extractDomCards($, 'https://x.cl', ['[data-testid="pod"]']);

  assert.equal(offers[0]?.price, 3990);
  assert.equal(offers[0]?.listPrice, null, 'no se inventa una rebaja del 99%');
});

test('una rebaja creible si se conserva', () => {
  const $ = cheerio.load(`
    <div data-testid="pod">
      <a href="/producto/caja/p">Caja organizadora con tapa transparente</a>
      <span class="price">$12.990</span>
      <span class="price-normal">$19.990</span>
    </div>`);

  const offers = extractDomCards($, 'https://x.cl', ['[data-testid="pod"]']);

  assert.equal(offers[0]?.price, 12990);
  assert.equal(offers[0]?.listPrice, 19990);
});
