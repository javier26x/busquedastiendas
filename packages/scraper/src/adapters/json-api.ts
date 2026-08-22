import type { AdapterContext, RawOffer, StoreAdapter } from '../types.js';
import { fetchJson } from '../lib/http.js';
import { extractJsonOffers, topLevelKeys, type JsonCatalogOptions } from '../lib/json-catalog.js';

/**
 * Adaptador para tiendas que exponen su catalogo en JSON.
 *
 * Es la via mas barata que existe: una peticion, sin HTML que raspar ni
 * navegador que arrancar. Muchas plataformas la traen de fabrica sin que la
 * tienda lo sepa (ver `platform.ts`), asi que conviene probarla siempre antes
 * de recurrir a algo mas caro.
 *
 * Como con las busquedas HTML, se declaran varias URL candidatas y el
 * adaptador descubre cual responde en vez de depender de una sola.
 */
export interface JsonApiConfig {
  id: string;
  label: string;
  /** Base para resolver enlaces relativos. */
  base: string;
  /** URLs candidatas, en orden de preferencia. */
  buildUrls: (query: string, limit: number) => string[];
  /** Ajustes de extraccion propios de la tienda o plataforma. */
  catalog?: Omit<JsonCatalogOptions, 'base'>;
  headers?: Record<string, string>;
  enabled?: boolean;
}

/** Tras estos fallos totales seguidos, se deja de insistir durante la corrida. */
const MAX_CONSECUTIVE_FAILURES = 2;

export function createJsonApiAdapter(config: JsonApiConfig): StoreAdapter {
  let preferred = 0;
  let consecutiveFailures = 0;

  return {
    id: config.id,
    label: config.label,
    enabled: config.enabled ?? true,

    async search(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
      const urls = config.buildUrls(query, ctx.limit);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error(
          `se omite: ninguna de las ${urls.length} URL candidatas respondio en los intentos previos`,
        );
      }

      const order = [...new Set([preferred, ...urls.map((_url, index) => index)])];
      const failures: string[] = [];

      for (const index of order) {
        const url = urls[index];
        if (!url) continue;

        try {
          const payload = await fetchJson<unknown>(url, {
            headers: { Referer: `${config.base}/`, ...config.headers },
          });

          const offers = extractJsonOffers(payload, { base: config.base, ...config.catalog });

          if (offers.length > 0) {
            if (preferred !== index) {
              ctx.log(`${config.label}: usando ${url}`);
              preferred = index;
            }
            consecutiveFailures = 0;
            return offers.slice(0, ctx.limit);
          }

          // Las claves ayudan a distinguir "no vende esto" de "cambio el
          // formato", que desde afuera se ven igual.
          failures.push(`${url} -> sin productos reconocibles (claves: ${topLevelKeys(payload)})`);
        } catch (error) {
          failures.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      consecutiveFailures += 1;
      throw new Error(`ninguna URL devolvio productos. ${failures.join(' | ')}`);
    },
  };
}
