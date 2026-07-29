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
  const cards = config.cardSelectors
    .map((selector) => $(selector))
    .find((found) => found.length > 0);

  if (!cards || cards.length === 0) return [];

  const offers: RawOffer[] = [];

  cards.each((_index, element) => {
    const offer = cardToOffer($, $(element), config.base);
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

  // Importes: todo lo que parezca un precio dentro de la tarjeta. El menor es
  // el vigente y, si hay mas de uno, el mayor es el normal tachado.
  const prices = card
    .find('[data-testid*="price" i], [class*="price" i], [class*="precio" i]')
    .toArray()
    .flatMap((node) => {
      const parsed = parseClp($(node).text());
      return parsed === null ? [] : [parsed];
    });

  const unique = [...new Set(prices)].sort((a, b) => a - b);
  const price = unique[0];
  if (price === undefined) return null;

  const listPrice = unique.length > 1 ? unique[unique.length - 1] ?? null : null;

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

/** Ultimo segmento util de la URL, como identificador estable. */
function urlFingerprint(url: string): string {
  const path = url.split('?')[0] ?? url;
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function dedupe(offers: RawOffer[]): RawOffer[] {
  const seen = new Map<string, RawOffer>();
  for (const offer of offers) {
    const existing = seen.get(offer.externalId);
    if (!existing || offer.price < existing.price) seen.set(offer.externalId, offer);
  }
  return [...seen.values()];
}
