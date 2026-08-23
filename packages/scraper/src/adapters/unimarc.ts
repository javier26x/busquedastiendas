import type { AdapterContext, RawOffer, StoreAdapter } from '../types.js';
import { fetchJson } from '../lib/http.js';
import { parseClp } from '../lib/money.js';
import { truncate } from '../lib/text.js';

/**
 * Unimarc, por el BFF que usa su propio sitio.
 *
 * El buscador web pide `POST /catalog/product/search` y recibe el catalogo ya
 * resuelto. Se encontro capturando el XHR del navegador:
 *
 *   npm run diagnose -- --capture='https://www.unimarc.cl/search?q=panales' \
 *                       --sample='catalog/product/search'
 *
 * El extractor generico no servia aca: el nombre vive en `item` y el precio en
 * `price`, que son ramas hermanas, y aquel exige que ambos esten en el mismo
 * objeto. Con la forma conocida sale directo y ademas queda mas robusto.
 */

const API = 'https://bff-unimarc-ecommerce.unimarc.cl/catalog/product/search';
const SITE = 'https://www.unimarc.cl';

/**
 * Cabeceras propias que el BFF exige.
 *
 * Sin `version` y `source` responde 422 nombrandolas; `channel` la manda el
 * sitio siempre y se replica por coherencia. Su navegador manda ademas
 * `anonymous` y `session` (identificadores aleatorios), pero no los pide.
 */
const BFF_HEADERS = {
  version: '1.0.0',
  source: 'web',
  channel: 'UNIMARC',
} as const;

/** Tope por peticion. `to` es inclusivo, asi que se resta uno. */
const MAX_RESULTS = 50;

interface UnimarcResponse {
  availableProducts?: UnimarcEntry[];
  notAvailableProducts?: UnimarcEntry[];
}

interface UnimarcEntry {
  price?: {
    price?: string;
    listPrice?: string;
    priceWithoutDiscount?: string;
    inOffer?: boolean;
    availableQuantity?: number;
  };
  priceDetail?: {
    /** No vacio cuando el precio exige un medio de pago concreto. */
    paymentMethod?: unknown[];
    /** No vacio cuando exige ser socio de un programa. */
    membership?: unknown[];
  };
  item?: {
    itemId?: string;
    sku?: string;
    productId?: string;
    name?: string;
    nameComplete?: string;
    brand?: string;
    images?: string[];
    /** Ruta de la ficha, ej: "/panal-super-premium-xxxg/p". */
    slug?: string;
  };
}

export function createUnimarcAdapter(config: { enabled?: boolean } = {}): StoreAdapter {
  return {
    id: 'unimarc',
    label: 'Unimarc',
    enabled: config.enabled ?? true,

    async search(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
      const payload = await fetchJson<UnimarcResponse>(API, {
        method: 'POST',
        // Se repite el cuerpo tal como lo manda el sitio, incluido el rango
        // completo: pedir menos devolvia 422. Recortar a `limit` se hace
        // despues, que no le cuesta nada a la tienda.
        body: JSON.stringify({
          from: '0',
          to: String(MAX_RESULTS - 1),
          searching: query,
          orderBy: '',
          promotionsOnly: false,
          userTriggered: true,
        }),
        // El cliente ya manda las cabeceras de una llamada de API al detectar
        // el POST con cuerpo; aqui van de donde viene y las propias del BFF.
        headers: {
          'Content-Type': 'application/json',
          Origin: SITE,
          Referer: `${SITE}/`,
          ...BFF_HEADERS,
        },
      });

      // Los agotados igual interesan: se sigue su precio y el panel los marca.
      const offers = [
        ...toOffers(payload?.availableProducts, true),
        ...toOffers(payload?.notAvailableProducts, false),
      ];

      if (offers.length === 0) {
        ctx.log('Unimarc: el BFF respondio pero sin productos', { query });
      }

      return offers.slice(0, ctx.limit);
    },
  };
}

function toOffers(entries: UnimarcEntry[] | undefined, available: boolean): RawOffer[] {
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry) => {
    const offer = toOffer(entry, available);
    return offer ? [offer] : [];
  });
}

function toOffer(entry: UnimarcEntry, available: boolean): RawOffer | null {
  const item = entry.item;
  const price = entry.price;
  if (!item || !price) return null;

  const title = item.nameComplete?.trim() || item.name?.trim();
  const externalId = item.itemId?.trim() || item.sku?.trim() || item.productId?.trim();
  if (!title || !externalId) return null;

  const normal = parseClp(price.listPrice ?? price.priceWithoutDiscount ?? null);
  const vigente = parseClp(price.price ?? null);

  // Si el descuento exige medio de pago o ser socio, no lo paga cualquiera y
  // se guarda el precio sin condiciones. Se decide con los campos que la
  // propia API expone, y no con el texto de la etiqueta promocional: esa dice
  // "Club Unimarc" incluso en ofertas abiertas a todo el mundo.
  const condicionado =
    (entry.priceDetail?.paymentMethod?.length ?? 0) > 0 ||
    (entry.priceDetail?.membership?.length ?? 0) > 0;

  const final = condicionado ? (normal ?? vigente) : (vigente ?? normal);
  if (final === null) return null;

  const listPrice = normal !== null && normal > final ? normal : null;

  return {
    externalId,
    title: truncate(title),
    url: item.slug ? `${SITE}${item.slug}` : `${SITE}/product/${externalId}`,
    image: item.images?.find((src) => typeof src === 'string' && src.trim()) ?? null,
    brand: item.brand?.trim() || null,
    price: final,
    listPrice,
    currency: 'CLP',
    available: available && (price.availableQuantity ?? 1) > 0,
    // `inOffer` es de la tienda; si viene, manda sobre el descuento inferido.
    ...(typeof price.inOffer === 'boolean' && !condicionado ? { offerFlag: price.inOffer } : {}),
  };
}
