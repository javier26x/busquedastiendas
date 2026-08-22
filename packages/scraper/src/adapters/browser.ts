import * as cheerio from 'cheerio';
import type { AdapterContext, RawOffer, StoreAdapter } from '../types.js';
import { renderPage, type CapturedJson } from '../lib/browser.js';
import { extractJsonOffers } from '../lib/json-catalog.js';
import { extractStructuredOffers } from './html-search.js';
import { extractDomCards } from './dom-cards.js';

/**
 * Adaptador que abre la tienda en un Chromium real.
 *
 * Es el ultimo recurso, y el mas caro: sirve para las tiendas que responden
 * 403 a un cliente HTTP por su huella TLS, y para las que cargan los
 * productos por XHR y dejan el HTML inicial vacio.
 *
 * Una vez renderizada la pagina se intentan tres lecturas, de mejor a peor
 * calidad: los datos estructurados, el JSON que la propia pagina pidio por
 * XHR, y por ultimo las tarjetas del DOM.
 *
 * La del medio es la que rescata a las tiendas cuyo HTML no dice nada:
 * cargan los productos por detras desde su API y esa respuesta es un JSON
 * limpio. Ademas deja anotada la direccion de esa API en el log, que es el
 * primer paso para dejar de necesitar navegador.
 */
export interface BrowserStoreConfig {
  id: string;
  label: string;
  base: string;
  buildUrls: (query: string) => string[];
  /** Selectores de tarjeta, para las tiendas sin datos estructurados. */
  cardSelectors?: string[];
  /** Se espera a que aparezca antes de leer el HTML. */
  waitForSelector?: string;
  /** Gracia extra tras la carga, para el contenido que llega por XHR. */
  settleMs?: number;
  buildProductUrl?: (node: Record<string, unknown>) => string | null;
  /** Leer el JSON que pide la pagina. Solo se desactiva para depurar. */
  captureJson?: boolean;
  enabled?: boolean;
}

/** Tarjetas habituales cuando la tienda no declara las suyas. */
const DEFAULT_CARD_SELECTORS = [
  '[data-testid*="pod"]',
  '[data-testid*="product-card"]',
  '[data-cnstrc-item="Product"]',
  'article[class*="product" i]',
  'li[class*="product" i]',
];

export function createBrowserAdapter(config: BrowserStoreConfig): StoreAdapter {
  const cardSelectors = config.cardSelectors ?? DEFAULT_CARD_SELECTORS;
  let preferred = 0;

  return {
    id: config.id,
    label: config.label,
    enabled: config.enabled ?? true,

    async search(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
      const urls = config.buildUrls(query);
      const order = [...new Set([preferred, ...urls.map((_url, index) => index)])];
      const failures: string[] = [];

      for (const index of order) {
        const url = urls[index];
        if (!url) continue;

        try {
          const captureJson = config.captureJson ?? true;
          const { html, json } = await renderPage(url, {
            ...(config.waitForSelector ? { waitForSelector: config.waitForSelector } : {}),
            settleMs: config.settleMs ?? 1200,
            captureJson,
          });
          const $ = cheerio.load(html);

          const structured = extractStructuredOffers($, config.base, {
            ...(config.buildProductUrl ? { buildProductUrl: config.buildProductUrl } : {}),
          });
          if (structured.length > 0) {
            preferred = index;
            ctx.log(`${config.label}: ${structured.length} desde datos estructurados (navegador)`);
            return structured.slice(0, ctx.limit);
          }

          const captured = bestCapture(json, config.base);
          if (captured) {
            preferred = index;
            ctx.log(
              `${config.label}: ${captured.offers.length} desde el XHR de la tienda (navegador)`,
              // Con esta direccion se puede escribir un adaptador HTTP y
              // ahorrarse el navegador por completo.
              { api: captured.url },
            );
            return captured.offers.slice(0, ctx.limit);
          }

          const cards = extractDomCards($, config.base, cardSelectors);
          if (cards.length > 0) {
            preferred = index;
            ctx.log(`${config.label}: ${cards.length} desde tarjetas del DOM (navegador)`);
            return cards.slice(0, ctx.limit);
          }

          failures.push(
            `${url} -> pagina renderizada pero sin productos reconocibles` +
              (captureJson ? ` (${json.length} respuestas JSON revisadas)` : ''),
          );
        } catch (error) {
          failures.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      throw new Error(`el navegador no encontro productos. ${failures.join(' | ')}`);
    },
  };
}

/**
 * La respuesta capturada que mas productos aporto.
 *
 * Una tienda pide varios JSON mientras carga (banners, recomendados,
 * analitica) y a veces mas de uno trae productos. El listado de resultados es
 * el que trae mas, y quedarse con el evita mezclarlo con los sugeridos.
 */
export function bestCapture(
  captured: CapturedJson[],
  base: string,
): { url: string; offers: RawOffer[] } | null {
  let best: { url: string; offers: RawOffer[] } | null = null;

  for (const entry of captured) {
    const offers = extractJsonOffers(entry.body, { base });
    if (offers.length === 0) continue;
    if (!best || offers.length > best.offers.length) best = { url: entry.url, offers };
  }

  return best;
}
