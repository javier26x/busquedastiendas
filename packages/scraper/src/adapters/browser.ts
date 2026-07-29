import * as cheerio from 'cheerio';
import type { AdapterContext, RawOffer, StoreAdapter } from '../types.js';
import { renderHtml } from '../lib/browser.js';
import { extractStructuredOffers } from './html-search.js';
import { extractDomCards } from './dom-cards.js';

/**
 * Adaptador que abre la tienda en un Chromium real.
 *
 * Es el ultimo recurso, y el mas caro: sirve para las tiendas que responden
 * 403 a un cliente HTTP por su huella TLS, y para las que cargan los
 * productos por XHR y dejan el HTML inicial vacio.
 *
 * Una vez renderizada la pagina, la extraccion es la misma que en las demas
 * tiendas: primero los datos estructurados, y si no hay, las tarjetas del
 * DOM. Lo unico distinto es como se consiguio el HTML.
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
          const html = await renderHtml(url, {
            ...(config.waitForSelector ? { waitForSelector: config.waitForSelector } : {}),
            settleMs: config.settleMs ?? 1200,
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

          const cards = extractDomCards($, config.base, cardSelectors);
          if (cards.length > 0) {
            preferred = index;
            ctx.log(`${config.label}: ${cards.length} desde tarjetas del DOM (navegador)`);
            return cards.slice(0, ctx.limit);
          }

          failures.push(`${url} -> pagina renderizada pero sin productos reconocibles`);
        } catch (error) {
          failures.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      throw new Error(`el navegador no encontro productos. ${failures.join(' | ')}`);
    },
  };
}
