import type {
  NormalizedOffer,
  RawOffer,
  SearchDefinition,
  StoreAdapter,
} from '../types.js';
import { discountPercent } from '../lib/money.js';
import { matchesRules, slugify } from '../lib/text.js';

/** Clave estable de un producto en Firestore. */
export function productKey(storeId: string, externalId: string): string {
  return `${slugify(storeId)}__${slugify(externalId)}`;
}

/**
 * Convierte ofertas crudas en documentos listos para guardar.
 *
 * Aplica el filtro de relevancia de la busqueda y fusiona duplicados: un
 * mismo producto puede aparecer en varias consultas o incluso en las dos
 * busquedas, y debe quedar como un unico documento con ambas etiquetas.
 */
export function normalizeOffers(
  adapter: StoreAdapter,
  search: SearchDefinition,
  offers: RawOffer[],
): NormalizedOffer[] {
  const kept: NormalizedOffer[] = [];

  for (const offer of offers) {
    if (!matchesRules(offer.title, search.match)) continue;

    const storeId = offer.storeId ?? adapter.id;
    const storeLabel = offer.storeLabel ?? adapter.label;
    const listPrice = offer.listPrice !== null && offer.listPrice > offer.price ? offer.listPrice : null;
    const discountPct = discountPercent(offer.price, listPrice);

    kept.push({
      ...offer,
      storeId,
      storeLabel,
      searchIds: [search.id],
      key: productKey(storeId, offer.externalId),
      // Un "precio normal" igual o menor al vigente no es una rebaja: se
      // descarta para no mostrar un tachado enganoso en el panel.
      listPrice,
      isOffer: offer.offerFlag ?? discountPct !== null,
      discountPct,
    });
  }

  return kept;
}

/** Fusiona ofertas repetidas conservando el precio mas bajo y todas las busquedas. */
export function mergeOffers(offers: NormalizedOffer[]): NormalizedOffer[] {
  const merged = new Map<string, NormalizedOffer>();

  for (const offer of offers) {
    const existing = merged.get(offer.key);

    if (!existing) {
      merged.set(offer.key, { ...offer, searchIds: [...new Set(offer.searchIds)] });
      continue;
    }

    const searchIds = [...new Set([...existing.searchIds, ...offer.searchIds])];

    // Nos quedamos con el registro mas barato, pero acumulando las busquedas.
    const winner = offer.price < existing.price ? offer : existing;
    merged.set(offer.key, { ...winner, searchIds });
  }

  return [...merged.values()];
}
