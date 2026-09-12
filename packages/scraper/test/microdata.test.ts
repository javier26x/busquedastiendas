import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { extractStructuredOffers } from '../src/adapters/html-search.js';

/**
 * El maquetado esta copiado del buscador real de abc.cl (ex La Polar y
 * ABCDIN), que corre sobre Salesforce Commerce Cloud: microdatos schema.org
 * en la ficha, el precio en `.price-value[data-value]` con su etiqueta al
 * lado, y la copia para GTM en `data-gtm`.
 */
function tile(options: {
  id: string;
  name: string;
  internet: string;
  normal?: string;
  tarjeta?: string;
}): string {
  const precio = (clase: string, etiqueta: string, valor: string): string => `
    <p class="${clase} price">
      <span class="price-label">${etiqueta}</span>
      <span class="price-value" data-value="${valor}">$${valor}</span>
    </p>`;

  const gtm = JSON.stringify({
    event: 'ImpressionsUpdate',
    ecommerce: {
      currencyCode: 'CLP',
      impressions: { name: options.name, id: options.id, price: options.internet, brand: 'RIMAX' },
    },
  }).replace(/"/g, '&quot;');

  return `
  <div class="product-tile__item" data-product-position="0">
    <div class="lp-product-tile" itemscope itemtype="http://schema.org/Product" data-gtm="${gtm}">
      <div class="product-detail" data-pid="${options.id}"></div>
      <a itemprop="url" href="/producto/${options.id}.html">
        <img itemprop="image" src="/media/${options.id}.jpg" />
      </a>
      <h2 itemprop="name">${options.name}</h2>
      <div class="prices">
        ${precio('internet js-internet-price', 'Internet', options.internet)}
        ${options.normal ? precio('normal js-normal-price', 'Normal', options.normal) : ''}
        ${options.tarjeta ? precio('tarjeta js-card-price', 'Tarjeta ABC', options.tarjeta) : ''}
      </div>
    </div>
  </div>`;
}

function extract(html: string) {
  return extractStructuredOffers(cheerio.load(`<html><body>${html}</body></html>`), 'https://www.abc.cl');
}

test('lee una ficha marcada con microdatos schema.org', () => {
  const offers = extract(
    tile({ id: '23060035', name: 'Caja Organizadora Rimax Rx3436', internet: '19990', normal: '39990' }),
  );

  assert.equal(offers.length, 1);
  const offer = offers[0];

  assert.equal(offer?.externalId, '23060035');
  assert.equal(offer?.title, 'Caja Organizadora Rimax Rx3436');
  assert.equal(offer?.url, 'https://www.abc.cl/producto/23060035.html');
  assert.equal(offer?.image, 'https://www.abc.cl/media/23060035.jpg');
  assert.equal(offer?.price, 19990);
  assert.equal(offer?.listPrice, 39990);
  assert.equal(offer?.available, true);
});

test('el precio de tarjeta no se toma como precio vigente', () => {
  // Es el mas bajo de los tres, asi que un extractor ingenuo lo elegiria y
  // mostraria una rebaja que no obtiene quien no tiene esa tarjeta.
  const offers = extract(
    tile({
      id: '1',
      name: 'Caja Organizadora',
      internet: '19990',
      normal: '39990',
      tarjeta: '14990',
    }),
  );

  assert.equal(offers[0]?.price, 19990);
  assert.equal(offers[0]?.listPrice, 39990);
});

test('sin precio normal no se inventa uno tachado', () => {
  const offers = extract(tile({ id: '2', name: 'Canasta Organizadora', internet: '9990' }));

  assert.equal(offers[0]?.price, 9990);
  assert.equal(offers[0]?.listPrice, null);
});

test('la marca sale del dato que la ficha manda a GTM', () => {
  const offers = extract(tile({ id: '3', name: 'Caja Rimax', internet: '9990' }));
  assert.equal(offers[0]?.brand, 'RIMAX');
});

test('una ficha agotada se marca como no disponible', () => {
  const html = tile({ id: '4', name: 'Caja Organizadora', internet: '9990' }).replace(
    '<div class="prices">',
    '<span class="availability">Sin stock</span><div class="prices">',
  );

  assert.equal(extract(html)[0]?.available, false);
});

test('un data-value que no es precio se ignora', () => {
  // Los filtros del buscador tambien usan `data-value`, y un numero suelto
  // en ese rango pasaria por precio.
  const html = tile({ id: '5', name: 'Caja Organizadora', internet: '9990' }).replace(
    '<div class="prices">',
    '<li class="filter-option" data-value="1500">Hasta 1.500 unidades</li><div class="prices">',
  );

  assert.equal(extract(html)[0]?.price, 9990);
});

test('el JSON-LD tiene prioridad sobre los microdatos', () => {
  // Una tienda puede publicar ambos, y el JSON-LD es el mas fiable de los dos.
  const html = `
    <script type="application/ld+json">
      ${JSON.stringify({
        '@type': 'Product',
        name: 'Desde JSON-LD',
        sku: 'LD-1',
        url: 'https://www.abc.cl/ld.html',
        offers: { price: '12990' },
      })}
    </script>
    ${tile({ id: '6', name: 'Desde microdatos', internet: '9990' })}`;

  const offers = extract(html);
  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.title, 'Desde JSON-LD');
});

test('varias fichas se leen como productos distintos', () => {
  const offers = extract(
    tile({ id: 'a', name: 'Caja A', internet: '9990' }) +
      tile({ id: 'b', name: 'Caja B', internet: '19990' }),
  );

  assert.deepEqual(
    offers.map((offer) => offer.externalId).sort(),
    ['a', 'b'],
  );
});

test('una pagina sin microdatos ni JSON-LD no devuelve nada', () => {
  assert.deepEqual(extract('<div class="product"><h2>Caja</h2><span>$9.990</span></div>'), []);
});
