import type { AdapterContext, RawOffer, StoreAdapter } from '../types.js';
import { fetchJson } from '../lib/http.js';
import { parseClp } from '../lib/money.js';
import { slugify, truncate } from '../lib/text.js';

/**
 * SoloTodo, el comparador chileno, por su API publica.
 *
 * No es una tienda sino un agregador, y ahi esta su valor: cubre catorce de
 * las tiendas que interesan, incluidas las nueve que a este scraper le
 * resultaron inalcanzables (Lider tras PerimeterX, Paris, Ripley, Easy, Jumbo,
 * Santa Isabel, La Polar, ABCDIN, SP Digital y Winpy). Una integracion las
 * trae todas.
 *
 * En su modelo una `entity` es un producto en UNA tienda con su precio, que
 * es exactamente la forma de `RawOffer`: no hay que deshacer su cruce entre
 * tiendas, ya viene desagregado.
 *
 * Cada oferta se atribuye a su tienda real (`storeId`/`storeLabel`), asi que
 * en el panel aparece como "Paris" o "Lider", no como "SoloTodo".
 */

const API = 'https://api.solotodo.com';

/** La API devuelve 100 por pagina; con una basta para monitorear precios. */
const PAGE_SIZE = 100;

/**
 * Antiguedad maxima del precio.
 *
 * `/entities/` incluye todo lo que SoloTodo scrapeo alguna vez, con listados
 * muertos desde 2020 y su `active_registry` vacio. Ordenar por fecha deja los
 * vivos primero, pero el corte por antiguedad es la garantia de que no entre
 * un precio viejo al panel: seria peor que no tener la tienda.
 */
const MAX_PRICE_AGE_DAYS = 7;

interface EntitiesResponse {
  count?: number;
  results?: Entity[];
}

interface Entity {
  id?: number;
  name?: string;
  sku?: string;
  key?: string;
  external_url?: string;
  store?: number;
  picture_urls?: string[] | null;
  /** Ultimo precio observado. Nulo en los listados que ya no se siguen. */
  active_registry?: {
    normal_price?: string;
    offer_price?: string;
    is_available?: boolean;
    timestamp?: string;
  } | null;
}

interface StoreInfo {
  id?: number;
  name?: string;
  country?: unknown;
}

export interface SoloTodoConfig {
  enabled?: boolean;
  /** Nombres de tienda a incluir. Vacio o ausente: todas. */
  onlyStores?: string[];
}

export function createSoloTodoAdapter(config: SoloTodoConfig = {}): StoreAdapter {
  // El catalogo de tiendas cambia poco: se pide una vez por corrida y se
  // reutiliza, en vez de una llamada por producto para traducir el id.
  let stores: Promise<Map<number, string>> | null = null;

  const wanted = new Set((config.onlyStores ?? []).map((name) => name.toLowerCase()));

  return {
    id: 'solotodo',
    label: 'SoloTodo',
    enabled: config.enabled ?? true,

    async search(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
      stores ??= loadStores();
      const names = await stores;

      const url =
        `${API}/entities/?format=json&search=${encodeURIComponent(query)}` +
        // Sin este orden la primera pagina viene llena de listados muertos:
        // de cada cinco, cuatro sin precio.
        `&ordering=-last_pricing_update&page_size=${PAGE_SIZE}`;

      const payload = await fetchJson<EntitiesResponse>(url, {
        headers: { Accept: 'application/json' },
      });

      const entities = Array.isArray(payload?.results) ? payload.results : [];
      const cutoff = Date.now() - MAX_PRICE_AGE_DAYS * 24 * 60 * 60 * 1000;

      let sinPrecio = 0;
      let viejos = 0;

      const offers = entities.flatMap((entity) => {
        const registry = entity.active_registry;
        if (!registry) {
          sinPrecio += 1;
          return [];
        }

        const stamp = Date.parse(registry.timestamp ?? '');
        if (Number.isFinite(stamp) && stamp < cutoff) {
          viejos += 1;
          return [];
        }

        const offer = toOffer(entity, registry, names, wanted);
        return offer ? [offer] : [];
      });

      ctx.log(
        `SoloTodo: ${offers.length} con precio vigente de ${entities.length}` +
          (sinPrecio > 0 ? `, ${sinPrecio} sin precio` : '') +
          (viejos > 0 ? `, ${viejos} con precio de mas de ${MAX_PRICE_AGE_DAYS} dias` : ''),
      );

      return offers.slice(0, ctx.limit);
    },
  };
}

function toOffer(
  entity: Entity,
  registry: NonNullable<Entity['active_registry']>,
  names: Map<number, string>,
  wanted: Set<string>,
): RawOffer | null {
  const title = entity.name?.trim();
  const url = entity.external_url?.trim();
  if (!title || !url) return null;

  const storeName = entity.store === undefined ? null : (names.get(entity.store) ?? null);
  if (!storeName) return null;
  if (wanted.size > 0 && !wanted.has(storeName.toLowerCase())) return null;

  // `offer_price` es lo que se paga hoy; `normal_price` el de lista.
  const price = parseClp(registry.offer_price ?? registry.normal_price ?? null);
  if (price === null) return null;

  const normal = parseClp(registry.normal_price ?? null);

  return {
    // El id de la entity es unico por tienda y producto, que es justo la
    // granularidad de este proyecto.
    externalId: String(entity.id ?? entity.key ?? entity.sku ?? url),
    title: truncate(title),
    url,
    image: entity.picture_urls?.find((src) => typeof src === 'string' && src.trim()) ?? null,
    brand: null,
    price,
    listPrice: normal !== null && normal > price ? normal : null,
    currency: 'CLP',
    available: registry.is_available !== false,
    // La oferta se atribuye a la tienda real, no al comparador: en el panel
    // tiene que decir "Paris", que es donde se compra.
    storeId: `solotodo-${slugify(storeName)}`,
    storeLabel: storeName,
  };
}

/** Catalogo de tiendas: traduce el id numerico de cada entity a su nombre. */
async function loadStores(): Promise<Map<number, string>> {
  const list = await fetchJson<StoreInfo[]>(`${API}/stores/?format=json`, {
    headers: { Accept: 'application/json' },
  });

  const map = new Map<number, string>();
  if (!Array.isArray(list)) return map;

  for (const store of list) {
    if (typeof store?.id === 'number' && typeof store.name === 'string' && store.name.trim()) {
      map.set(store.id, store.name.trim());
    }
  }

  return map;
}

