import type { AdapterContext, RawOffer, StoreAdapter } from '../types.js';
import { fetchJson } from '../lib/http.js';
import { extractJsonOffers, topLevelKeys } from '../lib/json-catalog.js';
import { slugify } from '../lib/text.js';

/**
 * PC Factory, leida por su API REST interna de catalogo.
 *
 * Es la via mas barata de todas las que usa este proyecto: un JSON sin
 * autenticacion, sin WAF y sin navegador de por medio.
 *
 * La forma exacta del JSON no esta documentada, asi que la extraccion la hace
 * `lib/json-catalog`, que recorre la respuesta buscando objetos con nombre y
 * precio en vez de asumir una ruta fija. Lo unico propio de la tienda es como
 * se elige el precio y como se arma el enlace.
 */

const API = 'https://api.pcfactory.cl/pcfactory-services-catalogo/v1/catalogo';
const SITE = 'https://www.pcfactory.cl';

/** La API ignora `size` por encima de esto y devuelve 48 igual. */
const MAX_PAGE_SIZE = 48;

/**
 * PC Factory publica `normal`, `efectivo`, `debito` y `bancoEstado`. Los tres
 * ultimos dependen de como pagues o de con que banco y son mas bajos:
 * guardarlos prometeria una rebaja que no obtiene cualquiera. El tachado sale
 * de `referencia`, que es el numero que se infla antes de un Cyber.
 */
const CATALOG = {
  base: SITE,
  priceKeys: ['normal', 'precioNormal', 'precio', 'valor', 'price'],
  listPriceKeys: ['referencia', 'precioReferencia', 'listPrice', 'antes'],
  priceContainers: ['precio'],
  // PC Factory rutea por el id numerico: el nombre que va detras es cosmetico.
  buildProductUrl: (node: Record<string, unknown>, id: string): string => {
    const name = typeof node['nombre'] === 'string' ? node['nombre'] : null;
    return name ? `${SITE}/producto/${id}-${slugify(name)}` : `${SITE}/producto/${id}`;
  },
};

export interface PcFactoryConfig {
  id?: string;
  label?: string;
  enabled?: boolean;
}

export function createPcFactoryAdapter(config: PcFactoryConfig = {}): StoreAdapter {
  const label = config.label ?? 'PC Factory';

  return {
    id: config.id ?? 'pcfactory',
    label,
    enabled: config.enabled ?? true,

    async search(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
      const size = Math.min(Math.max(ctx.limit, 1), MAX_PAGE_SIZE);
      const url = `${API}/productos?search=${encodeURIComponent(query)}&size=${size}`;

      const payload = await fetchJson<unknown>(url, {
        headers: { Referer: `${SITE}/`, Origin: SITE },
      });

      const offers = extractPcFactoryOffers(payload);

      if (offers.length === 0) {
        // Sin esto, un cambio de formato del JSON se ve igual que "la tienda
        // no vende nada parecido", y quedaria muda sin que se note.
        ctx.log(`${label}: la API respondio pero no se reconocio ningun producto`, {
          query,
          claves: topLevelKeys(payload),
        });
      }

      return offers.slice(0, ctx.limit);
    },
  };
}

/** Extrae las ofertas de la respuesta, sea cual sea el envoltorio. */
export function extractPcFactoryOffers(payload: unknown): RawOffer[] {
  return extractJsonOffers(payload, CATALOG);
}
