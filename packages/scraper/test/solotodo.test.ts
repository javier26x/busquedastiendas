import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSoloTodoAdapter } from '../src/adapters/solotodo.js';
import type { AdapterContext, RawOffer } from '../src/types.js';

/** La forma de estos objetos salio de la API real de SoloTodo. */

const STORES = [
  { id: 18, name: 'Paris' },
  { id: 8147, name: 'Lider' },
  { id: 8015, name: 'Ripley' },
];

function entity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1910033,
    name: 'Lavavajillas Mademsa 14C BZG  14 cubiertos',
    sku: '1122516',
    key: '1122516',
    external_url: 'https://www.paris.cl/lavavajillas-mademsa-14c-bzg.html',
    store: 18,
    picture_urls: ['https://cdn.paris.cl/lavavajillas.jpg'],
    active_registry: {
      id: 552620171,
      timestamp: new Date().toISOString(),
      is_available: true,
      normal_price: '349990.00',
      offer_price: '329990.00',
    },
    ...overrides,
  };
}

const ctx: AdapterContext = { limit: 30, log: () => undefined };

/** Corre el adaptador contra respuestas fijas, sin salir a la red. */
async function searchWith(
  entities: unknown[],
  config: Parameters<typeof createSoloTodoAdapter>[0] = {},
): Promise<RawOffer[]> {
  const original = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL) => {
    const body = String(url).includes('/stores/') ? STORES : { count: entities.length, results: entities };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    return await createSoloTodoAdapter(config).search('lavavajillas', ctx);
  } finally {
    globalThis.fetch = original;
  }
}

test('cada oferta se atribuye a la tienda real, no al comparador', async () => {
  // Lo que importa del panel: dice "Paris", que es donde se compra.
  const [offer] = await searchWith([entity()]);

  assert.ok(offer);
  assert.equal(offer.storeLabel, 'Paris');
  assert.equal(offer.storeId, 'solotodo-paris');
  assert.equal(offer.price, 329990, 'offer_price es lo que se paga hoy');
  assert.equal(offer.listPrice, 349990, 'normal_price es el tachado');
  assert.equal(offer.url, 'https://www.paris.cl/lavavajillas-mademsa-14c-bzg.html');
});

test('sin active_registry no hay oferta: es un listado muerto', async () => {
  // `/entities/` incluye todo lo que scrapearon alguna vez; los que ya no
  // siguen vienen con el registro vacio.
  const offers = await searchWith([entity({ active_registry: null })]);

  assert.deepEqual(offers, []);
});

test('un precio viejo no entra al panel', async () => {
  // Hay entities con precios de 2020. Guardarlos como vigentes seria peor
  // que no tener la tienda: el panel calcularia variaciones contra ellos.
  const viejo = entity({
    active_registry: {
      timestamp: '2020-11-01T06:47:18.363726Z',
      is_available: true,
      normal_price: '349990.00',
      offer_price: '349990.00',
    },
  });

  assert.deepEqual(await searchWith([viejo]), []);
});

test('las tiendas se traducen de su id numerico', async () => {
  const offers = await searchWith([
    entity({ id: 1, store: 8147 }),
    entity({ id: 2, store: 8015 }),
    // Un id que no esta en el catalogo no se puede atribuir a nadie.
    entity({ id: 3, store: 99999 }),
  ]);

  assert.deepEqual(
    offers.map((o) => o.storeLabel),
    ['Lider', 'Ripley'],
  );
});

test('se puede limitar a un conjunto de tiendas', async () => {
  const offers = await searchWith(
    [entity({ id: 1, store: 18 }), entity({ id: 2, store: 8147 })],
    { onlyStores: ['Lider'] },
  );

  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.storeLabel, 'Lider');
});

test('sin rebaja no se inventa un tachado', async () => {
  const sinRebaja = entity({
    active_registry: {
      timestamp: new Date().toISOString(),
      is_available: true,
      normal_price: '349990.00',
      offer_price: '349990.00',
    },
  });

  const [offer] = await searchWith([sinRebaja]);
  assert.equal(offer?.price, 349990);
  assert.equal(offer?.listPrice, null);
});

test('un producto agotado se sigue, marcado como no disponible', async () => {
  const agotado = entity({
    active_registry: {
      timestamp: new Date().toISOString(),
      is_available: false,
      normal_price: '349990.00',
      offer_price: '329990.00',
    },
  });

  const [offer] = await searchWith([agotado]);
  assert.equal(offer?.available, false);
});
