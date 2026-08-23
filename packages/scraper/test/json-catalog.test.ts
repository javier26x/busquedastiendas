import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonOffers } from '../src/lib/json-catalog.js';
import { bestCapture } from '../src/adapters/browser.js';
import type { CapturedJson } from '../src/lib/browser.js';

const BASE = 'https://www.tienda.cl';

/** Una respuesta capturada del navegador. El metodo no afecta la extraccion. */
function captured(url: string, body: unknown): CapturedJson {
  return { url, body, method: 'GET', requestBody: null, requestHeaders: {} };
}

/**
 * Respuestas con la forma real de cada plataforma. Son el contrato que el
 * extractor generico tiene que cumplir sin saber de antemano cual le toca.
 */

test('Shopify: la busqueda predictiva se lee entera', () => {
  const payload = {
    resources: {
      results: {
        products: [
          {
            id: 7712,
            title: 'Caja organizadora apilable 45L',
            handle: 'caja-organizadora-45l',
            url: '/products/caja-organizadora-45l',
            price: '19990.00',
            compare_at_price: '24990.00',
            vendor: 'Wenco',
            available: true,
            image: '//cdn.shopify.com/s/files/1/caja.jpg',
          },
        ],
      },
    },
  };

  const [offer] = extractJsonOffers(payload, {
    base: BASE,
    priceKeys: ['price'],
    listPriceKeys: ['compare_at_price'],
    stockKeys: ['available'],
  });

  assert.ok(offer);
  assert.equal(offer.price, 19990);
  assert.equal(offer.listPrice, 24990);
  assert.equal(offer.brand, 'Wenco');
  assert.equal(offer.url, `${BASE}/products/caja-organizadora-45l`);
  assert.equal(
    offer.image,
    'https://cdn.shopify.com/s/files/1/caja.jpg',
    'la URL sin protocolo tiene que quedar utilizable',
  );
});

test('Shopify: sin campo url, el enlace se arma desde el handle', () => {
  // El handle es un identificador, no una URL: pegarlo a la base daria
  // tienda.cl/caja-x en vez de tienda.cl/products/caja-x.
  const payload = {
    resources: {
      results: {
        products: [
          { id: 1, title: 'Caja organizadora apilable 45L', handle: 'caja-x', price: '19990' },
        ],
      },
    },
  };

  const [offer] = extractJsonOffers(payload, {
    base: BASE,
    priceKeys: ['price'],
    buildProductUrl: (node) => `${BASE}/products/${String(node['handle'])}`,
  });

  assert.equal(offer?.url, `${BASE}/products/caja-x`);
});

test('WooCommerce: el precio viene en la unidad menor de la moneda', () => {
  const payload = [
    {
      id: 331,
      name: 'Bodega de jardin PVC 4x6',
      permalink: 'https://www.tienda.cl/producto/bodega-pvc',
      on_sale: true,
      is_in_stock: true,
      prices: {
        price: '54999000',
        regular_price: '69999000',
        currency_minor_unit: 2,
      },
    },
  ];

  const [offer] = extractJsonOffers(payload, {
    base: BASE,
    priceKeys: ['price'],
    listPriceKeys: ['regular_price'],
    priceContainers: ['prices'],
    stockKeys: ['is_in_stock'],
    offerKeys: ['on_sale'],
    adjustPrice: (price) => Math.round(price / 100),
  });

  assert.ok(offer);
  assert.equal(offer.price, 549990);
  assert.equal(
    offer.listPrice,
    699990,
    'si el ajuste solo se aplicara al precio vigente, el tachado inventaria un descuento',
  );
  assert.equal(offer.offerFlag, true);
});

test('un precio por variante toma la mas barata, no la primera', () => {
  const payload = {
    products: [
      {
        id: 'A1',
        title: 'Set de cajas organizadoras',
        url: '/p/set',
        variants: [
          { id: 'v1', title: 'Pack 3', price: 29990 },
          { id: 'v2', title: 'Pack 1', price: 11990 },
        ],
      },
    ],
  };

  const [offer] = extractJsonOffers(payload, { base: BASE, priceKeys: ['price'] });

  assert.ok(offer);
  assert.equal(offer.price, 11990, 'es el precio "desde" que anuncia la tienda');
  assert.equal(offer.externalId, 'A1', 'el producto es el padre, no la variante');
});

test('el precio condicionado a un medio de pago nunca es el precio del producto', () => {
  // Sin nombres conocidos, el extractor cae al barrido del contenedor. Ahi es
  // donde importa descartar lo condicionado: es siempre lo mas barato.
  const payload = {
    items: [
      {
        id: 90,
        nombre: 'Monitor curvo 27 pulgadas',
        url: '/p/90',
        precio: {
          montoLista: 199990,
          montoTarjetaTienda: 149990,
          montoBancoEstado: 139990,
          referencia: 249990,
        },
      },
    ],
  };

  const [offer] = extractJsonOffers(payload, { base: BASE, priceContainers: ['precio'] });

  assert.ok(offer);
  assert.equal(offer.price, 199990);
  assert.equal(offer.listPrice, 249990);
});

test('lo que no es un producto no se cuela', () => {
  const payload = {
    facets: [
      { name: 'Marca', count: 12 },
      { name: 'Precio', count: 4 },
    ],
    breadcrumb: [{ name: 'Inicio', url: '/' }],
    products: [],
  };

  assert.deepEqual(extractJsonOffers(payload, { base: BASE }), []);
});

test('sin enlace no hay oferta: el panel necesita poder abrir el producto', () => {
  const payload = { products: [{ id: 5, nombre: 'Caja organizadora 60L', precio: 9990 }] };

  assert.deepEqual(extractJsonOffers(payload, { base: BASE }), []);

  const [offer] = extractJsonOffers(payload, {
    base: BASE,
    buildProductUrl: (_node, id) => `${BASE}/p/${id}`,
  });
  assert.equal(offer?.url, `${BASE}/p/5`);
});

test('entre las respuestas capturadas gana la que trae mas productos', () => {
  // Una tienda pide varios JSON al cargar. El listado de resultados es el que
  // trae mas; quedarse con el evita mezclarlo con los recomendados.
  const producto = (id: number): Record<string, unknown> => ({
    id,
    nombre: `Caja organizadora modelo ${id}`,
    url: `/p/${id}`,
    precio: 9990 + id,
  });

  const best = bestCapture(
    [
      captured('https://www.tienda.cl/api/banners', { banners: [{ img: 'a.jpg' }] }),
      captured('https://www.tienda.cl/api/recomendados', { items: [producto(1)] }),
      captured('https://www.tienda.cl/api/search?q=caja', { items: [1, 2, 3].map(producto) }),
    ],
    BASE,
  );

  assert.equal(best?.url, 'https://www.tienda.cl/api/search?q=caja');
  assert.equal(best?.offers.length, 3);
});

test('si ninguna respuesta capturada trae productos, no se inventa una', () => {
  const best = bestCapture(
    [
      captured('https://www.tienda.cl/api/analytics', { ok: true }),
      captured('https://www.tienda.cl/api/menu', { categorias: ['hogar', 'jardin'] }),
    ],
    BASE,
  );

  assert.equal(best, null);
});
