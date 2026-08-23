import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUnimarcAdapter } from '../src/adapters/unimarc.js';
import type { AdapterContext, RawOffer } from '../src/types.js';

/**
 * La forma de estos objetos salio de capturar el XHR real del buscador:
 *
 *   npm run diagnose -- --capture='https://www.unimarc.cl/search?q=panales' \
 *                       --sample='catalog/product/search'
 */

/** El primer producto que devolvio la API, tal cual. */
const PANAL = {
  price: {
    price: '$31.990',
    listPrice: '$41.190',
    priceWithoutDiscount: '$41.190',
    availableQuantity: 10000,
    inOffer: true,
    ppum: '$296 x unidad',
    saving: 'Ahorras $9.200',
  },
  item: {
    itemId: '97214',
    sku: '97214',
    productId: '97605',
    name: 'Pañal Babysec super premium talla XXXG 108 un',
    nameComplete: 'Pañal Babysec super premium talla XXXG 108 un',
    brand: 'Babysec',
    images: [
      'https://unimarc.vtexassets.com/arquivos/ids/256851/000000000000702147-UN-01.jpg',
      'https://unimarc.vtexassets.com/arquivos/ids/256852/000000000000702147-UN-02.jpg',
    ],
    slug: '/panal-super-premium-xxxg-babysec-108-un/p',
  },
  priceDetail: {
    promotionalTag: { text: 'Club Unimarc' },
    discountPercentage: 22,
    paymentMethod: [],
    membership: [],
  },
};

const ctx: AdapterContext = { limit: 30, log: () => undefined };

/** Corre el adaptador contra una respuesta fija, sin salir a la red. */
async function searchWith(body: unknown): Promise<{ offers: RawOffer[]; request: RequestInit }> {
  const original = globalThis.fetch;
  let request: RequestInit = {};

  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    request = init ?? {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const offers = await createUnimarcAdapter().search('panales', ctx);
    return { offers, request };
  } finally {
    globalThis.fetch = original;
  }
}

test('lee el producto con los nombres reales de la API', async () => {
  const { offers } = await searchWith({ availableProducts: [PANAL] });
  const [offer] = offers;

  assert.ok(offer);
  assert.equal(offer.externalId, '97214');
  assert.equal(offer.title, 'Pañal Babysec super premium talla XXXG 108 un');
  assert.equal(offer.brand, 'Babysec');
  assert.equal(offer.price, 31990, 'los precios vienen formateados: "$31.990"');
  assert.equal(offer.listPrice, 41190);
  assert.equal(offer.offerFlag, true);
  assert.equal(offer.available, true);
  assert.equal(offer.url, 'https://www.unimarc.cl/panal-super-premium-xxxg-babysec-108-un/p');
  assert.ok(offer.image?.startsWith('https://unimarc.vtexassets.com/'));
});

test('la busqueda va por POST, con el termino en el cuerpo', async () => {
  // La URL no lleva parametros: si se mandara como GET no habria consulta.
  const { request } = await searchWith({ availableProducts: [PANAL] });

  assert.equal(request.method, 'POST');
  const body = JSON.parse(String(request.body)) as Record<string, unknown>;
  assert.equal(body['searching'], 'panales');
  assert.equal(body['from'], '0');
  assert.equal(body['to'], '29', 'to es inclusivo, asi que es limit - 1');
});

test('un descuento que exige medio de pago o ser socio no se guarda como precio', async () => {
  // La etiqueta dice "Club Unimarc" hasta en ofertas abiertas a todos, asi que
  // se decide por estos campos y no por el texto.
  const conTarjeta = {
    ...PANAL,
    priceDetail: { ...PANAL.priceDetail, paymentMethod: [{ name: 'Tarjeta Unimarc' }] },
  };

  const { offers } = await searchWith({ availableProducts: [conTarjeta] });

  assert.equal(offers[0]?.price, 41190, 'se guarda el precio que paga cualquiera');
  assert.equal(offers[0]?.listPrice, null, 'y entonces no hay rebaja que mostrar');
});

test('los agotados se siguen, marcados como no disponibles', async () => {
  const { offers } = await searchWith({
    availableProducts: [PANAL],
    notAvailableProducts: [{ ...PANAL, item: { ...PANAL.item, itemId: '99999' } }],
  });

  assert.equal(offers.length, 2, 'su precio interesa igual para el historial');
  assert.equal(offers.find((o) => o.externalId === '99999')?.available, false);
});

test('una respuesta vacia o incompleta no rompe la corrida', async () => {
  assert.deepEqual((await searchWith({})).offers, []);
  assert.deepEqual((await searchWith({ availableProducts: [] })).offers, []);
  // Sin `item` o sin `price` no hay nada que guardar.
  assert.deepEqual((await searchWith({ availableProducts: [{ price: PANAL.price }] })).offers, []);
  assert.deepEqual((await searchWith({ availableProducts: [{ item: PANAL.item }] })).offers, []);
});
