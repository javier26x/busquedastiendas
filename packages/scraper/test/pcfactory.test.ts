import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPcFactoryOffers } from '../src/adapters/pcfactory.js';

/**
 * La forma del JSON de PC Factory no esta documentada y su envoltorio puede
 * cambiar, asi que estos casos cubren las variantes plausibles ademas del
 * contenido: lo que no puede fallar es de donde sale el precio.
 */

function producto(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 940,
    nombre: 'Tarjeta de video RTX 5070 12GB GDDR7',
    marca: 'ASUS',
    stock: 4,
    imagen: '/media/940.jpg',
    precio: {
      normal: 719990,
      efectivo: 679990,
      debito: 679990,
      bancoEstado: 649990,
      referencia: 849990,
      promocion: true,
    },
    ...overrides,
  };
}

test('el precio guardado es el que paga cualquiera, no el de efectivo ni el del banco', () => {
  const [offer] = extractPcFactoryOffers({ content: [producto()] });

  assert.ok(offer);
  assert.equal(offer.price, 719990, 'efectivo, debito y bancoEstado exigen pagar de cierta forma');
  assert.equal(offer.listPrice, 849990, 'la referencia es el precio tachado');
  assert.equal(offer.offerFlag, true);
});

test('una referencia que no supera al precio vigente no se muestra como rebaja', () => {
  // Es el caso que importa vigilar: la referencia inflada antes de un Cyber
  // es real, pero una igual o menor al precio de hoy no es ningun descuento.
  const [offer] = extractPcFactoryOffers({
    content: [producto({ precio: { normal: 719990, referencia: 719990 } })],
  });

  assert.ok(offer);
  assert.equal(offer.listPrice, null);
});

test('los productos se encuentran sea cual sea el envoltorio de la respuesta', () => {
  const envoltorios: unknown[] = [
    [producto()],
    { content: [producto()] },
    { data: { productos: [producto()] } },
    { data: { catalogo: { items: { resultados: [producto()] } } } },
  ];

  for (const payload of envoltorios) {
    const offers = extractPcFactoryOffers(payload);
    assert.equal(offers.length, 1, `no se encontro el producto en ${JSON.stringify(payload).slice(0, 40)}`);
    assert.equal(offers[0]?.price, 719990);
  }
});

test('si renombran el campo del precio, se descarta lo condicionado y queda el resto', () => {
  const [offer] = extractPcFactoryOffers({
    content: [
      producto({
        precio: {
          precioLista: 719990,
          precioEfectivo: 679990,
          precioBancoEstado: 649990,
          referencia: 849990,
        },
      }),
    ],
  });

  assert.ok(offer, 'un cambio de nombre no deberia dejar la tienda muda');
  assert.equal(offer.price, 719990);
});

test('sin nombre o sin precio no hay oferta', () => {
  assert.deepEqual(extractPcFactoryOffers({ content: [producto({ nombre: null })] }), []);
  assert.deepEqual(extractPcFactoryOffers({ content: [producto({ precio: null })] }), []);
  assert.deepEqual(extractPcFactoryOffers({ mensaje: 'sin resultados' }), []);
});

test('el enlace se arma desde el id cuando la API no lo trae', () => {
  const [armado] = extractPcFactoryOffers({ content: [producto()] });
  assert.ok(armado?.url.startsWith('https://www.pcfactory.cl/producto/940-'));

  const [propio] = extractPcFactoryOffers({
    content: [producto({ url: 'https://www.pcfactory.cl/producto/940-rtx-5070' })],
  });
  assert.equal(propio?.url, 'https://www.pcfactory.cl/producto/940-rtx-5070');
});

test('las imagenes relativas quedan absolutas', () => {
  const [offer] = extractPcFactoryOffers({ content: [producto()] });
  assert.equal(offer?.image, 'https://www.pcfactory.cl/media/940.jpg');
});

test('el stock en cero marca el producto como no disponible', () => {
  const [agotado] = extractPcFactoryOffers({ content: [producto({ stock: 0 })] });
  assert.equal(agotado?.available, false);

  // Sin dato de stock se asume disponible: esconderlo seria peor que el error
  // contrario, porque el panel filtra por disponibilidad.
  const [sinDato] = extractPcFactoryOffers({ content: [producto({ stock: undefined })] });
  assert.equal(sinDato?.available, true);
});

test('un producto anidado dentro de otro no se cuenta como resultado aparte', () => {
  const conAccesorio = producto({
    accesorios: [producto({ id: 55, nombre: 'Cable de poder PCIe 5.0', precio: { normal: 12990 } })],
  });

  const offers = extractPcFactoryOffers({ content: [conAccesorio] });

  assert.equal(offers.length, 1, 'el accesorio sugerido no es un resultado de la busqueda');
  assert.equal(offers[0]?.externalId, '940');
});

test('el mismo producto repetido en la respuesta se guarda una vez', () => {
  const offers = extractPcFactoryOffers({
    destacados: [producto()],
    content: [producto()],
  });

  assert.equal(offers.length, 1);
});
