import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { AdapterContext, RawOffer, StoreAdapter } from '../types.js';
import { fetchHtml } from '../lib/http.js';
import { parseClp } from '../lib/money.js';
import { absoluteUrl, truncate } from '../lib/text.js';

/**
 * Adaptador para tiendas que renderizan los productos en el DOM y no dejan
 * ningun JSON aprovechable.
 *
 * Es el caso de Paris: la pagina trae 30 tarjetas `paris-vertical-pod` y
 * ni un solo bloque de datos estructurados.
 *
 * Para no depender de la maqueta interna de cada tarjeta, solo se configura
 * cual es la tarjeta; dentro se busca de forma generica el enlace, el titulo
 * y los importes. Es menos preciso que leer un JSON, pero sobrevive a los
 * cambios de clases mientras el contenedor siga identificandose igual.
 */
export interface DomCardsConfig {
  id: string;
  label: string;
  base: string;
  buildUrls: (query: string) => string[];
  /** Selectores de la tarjeta de producto, en orden de preferencia. */
  cardSelectors: string[];
  enabled?: boolean;
}

export function createDomCardsAdapter(config: DomCardsConfig): StoreAdapter {
  let preferredUrl = 0;

  return {
    id: config.id,
    label: config.label,
    enabled: config.enabled ?? true,

    async search(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
      const urls = config.buildUrls(query);
      const order = [...new Set([preferredUrl, ...urls.map((_url, index) => index)])];
      const failures: string[] = [];

      for (const index of order) {
        const url = urls[index];
        if (!url) continue;

        try {
          const html = await fetchHtml(url, { headers: { Referer: `${config.base}/` } });
          const $ = cheerio.load(html);
          const offers = extractCards($, config);

          if (offers.length > 0) {
            preferredUrl = index;
            return offers.slice(0, ctx.limit);
          }

          failures.push(`${url} -> ninguna tarjeta con precio`);
        } catch (error) {
          failures.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      throw new Error(`ninguna URL devolvio tarjetas. ${failures.join(' | ')}`);
    },
  };
}

function extractCards($: cheerio.CheerioAPI, config: DomCardsConfig): RawOffer[] {
  return extractDomCards($, config.base, config.cardSelectors);
}

/**
 * Extrae los productos de las tarjetas del DOM.
 *
 * Se exporta para que el adaptador de navegador la use sobre el HTML ya
 * renderizado: la unica diferencia entre ambos es como se obtuvo el HTML.
 */
export function extractDomCards(
  $: cheerio.CheerioAPI,
  base: string,
  cardSelectors: string[],
): RawOffer[] {
  const cards = cardSelectors.map((selector) => $(selector)).find((found) => found.length > 0);

  if (!cards || cards.length === 0) return [];

  const offers: RawOffer[] = [];

  cards.each((_index, element) => {
    const offer = cardToOffer($, $(element), base);
    if (offer) offers.push(offer);
  });

  return dedupe(offers);
}

function cardToOffer(
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
  base: string,
): RawOffer | null {
  // El enlace mas util es el que apunta al producto; se prefiere el primero
  // con texto, que suele ser el titulo.
  const anchors = card.find('a[href]').toArray();
  if (anchors.length === 0) return null;

  const href = anchors
    .map((anchor) => $(anchor).attr('href') ?? '')
    .find((candidate) => candidate.length > 1 && !candidate.startsWith('#'));

  const url = absoluteUrl(href, base);
  if (!url) return null;

  // Titulo: el texto mas largo entre los enlaces y encabezados de la tarjeta.
  const candidates = [
    ...anchors.map((anchor) => $(anchor).text()),
    ...card.find('h1, h2, h3, h4').toArray().map((node) => $(node).text()),
  ]
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter((text) => text.length >= 8);

  const title = candidates.sort((a, b) => b.length - a.length)[0];
  if (!title) return null;

  // Importes: el menor es el vigente y, si hay mas de uno, el mayor es el
  // normal tachado.
  //
  // Solo se miran los elementos que no contienen otro con precio dentro: el
  // texto de un contenedor incluye el de sus hijos concatenado, y "$3.990"
  // junto a "$3.990" se leeria como un solo importe de $39.903.990.
  const priceNodes = card
    .find(PRICE_SELECTOR)
    .toArray()
    .filter((node) => $(node).find(PRICE_SELECTOR).length === 0);

  const prices = priceNodes.flatMap((node) => extractPrices($(node).text()));

  const unique = [...new Set(prices)].sort((a, b) => a - b);
  const price = unique[0];
  if (price === undefined) return null;

  const highest = unique.length > 1 ? (unique[unique.length - 1] ?? null) : null;
  // Segunda red: si el "normal" implica una rebaja imposible, es basura.
  const listPrice =
    highest !== null && price >= highest * (1 - MAX_PLAUSIBLE_DISCOUNT) ? highest : null;

  const image =
    card.find('img').first().attr('src') ?? card.find('img').first().attr('data-src') ?? null;

  return {
    externalId: urlFingerprint(url),
    title: truncate(title),
    url: url.split('?')[0] ?? url,
    image: image ? absoluteUrl(image, base) : null,
    brand: null,
    price,
    listPrice: listPrice !== null && listPrice > price ? listPrice : null,
    currency: 'CLP',
    available: true,
  };
}

const PRICE_SELECTOR = '[data-testid*="price" i], [class*="price" i], [class*="precio" i]';

/**
 * Importes contenidos en un texto, cada uno por separado.
 *
 * Se buscan por patron en vez de parsear el texto entero, porque un mismo
 * nodo puede traer dos precios pegados y unirlos daria una cifra inventada.
 */
export function extractPrices(text: string): number[] {
  const tokens = text.match(/\$\s?\d{1,3}(?:[.\s]\d{3})+|\$\s?\d+/g);

  if (tokens) {
    return tokens.flatMap((token) => {
      const value = parseClp(token);
      return value === null ? [] : [value];
    });
  }

  // Sin simbolo de moneda solo se acepta un nodo que contenga la cifra y
  // nada mas. Si no, las medidas del producto pasarian por precio: de
  // "26x35x15 cm" salia un importe de $263.515.
  if (!/^\s*\$?\s*\d{1,3}(?:\.\d{3})*\s*$/.test(text)) return [];

  const single = parseClp(text);
  return single === null ? [] : [single];
}

/**
 * Un descuento asi de grande no existe en retail: viene de haber leido mal
 * el precio normal. Se descarta en vez de mostrar una rebaja inventada.
 */
const MAX_PLAUSIBLE_DISCOUNT = 0.9;

/**
 * Identificador estable derivado de la URL.
 *
 * Se usa la ruta completa y no el ultimo segmento: en las tiendas cuyas URL
 * terminan en `/p` (VTEX, Paris) ese segmento es el mismo para todos los
 * productos, y todos colapsarian en uno solo al deduplicar.
 */
function urlFingerprint(url: string): string {
  const path = (url.split('?')[0] ?? url).replace(/^https?:\/\/[^/]+/, '');
  const clean = path.replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
  return clean || url;
}

function dedupe(offers: RawOffer[]): RawOffer[] {
  const seen = new Map<string, RawOffer>();
  for (const offer of offers) {
    const existing = seen.get(offer.externalId);
    if (!existing || offer.price < existing.price) seen.set(offer.externalId, offer);
  }
  return [...seen.values()];
}
