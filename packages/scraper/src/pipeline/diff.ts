import type { NormalizedOffer, PriceHistoryEntry, ProductRecord } from '../types.js';
import { changePercent } from '../lib/money.js';

/** Que paso con el producto en esta corrida. */
export type ChangeKind = 'created' | 'drop' | 'rise' | 'unchanged';

export interface DiffResult {
  record: ProductRecord;
  /** Entrada a agregar al historial, o null si el precio no cambio. */
  history: PriceHistoryEntry | null;
  kind: ChangeKind;
}

/**
 * Calcula el documento final de un producto a partir de lo observado ahora
 * y de lo que ya habia en Firestore.
 *
 * Decision de diseno: `previousPrice` guarda el ultimo precio *distinto*, no
 * el de la corrida anterior. Asi "variacion" responde a "cuanto cambio la
 * ultima vez que se movio" y no se borra sola cuando el precio se mantiene
 * estable varios dias.
 *
 * Funcion pura para poder testearla sin Firestore.
 */
export function buildRecord(
  existing: ProductRecord | null,
  offer: NormalizedOffer,
  now: Date,
  runId: string,
  /**
   * Busquedas ejecutadas en esta corrida. Sirve para poder *quitar* etiquetas:
   * si una busqueda corrio y ya no encontro este producto, deja de aplicarle.
   * Las que no corrieron se conservan intactas.
   */
  ranSearchIds: ReadonlySet<string> = new Set(),
): DiffResult {
  const base = {
    key: offer.key,
    storeId: offer.storeId,
    storeLabel: offer.storeLabel,
    externalId: offer.externalId,
    title: offer.title,
    url: offer.url,
    image: offer.image,
    brand: offer.brand,
    currency: offer.currency,
    available: offer.available,
    price: offer.price,
    listPrice: offer.listPrice,
    isOffer: offer.isOffer,
    discountPct: offer.discountPct,
    lastSeenAt: now,
    lastRunId: runId,
  };

  const historyEntry: PriceHistoryEntry = {
    price: offer.price,
    listPrice: offer.listPrice,
    isOffer: offer.isOffer,
    capturedAt: now,
    runId,
  };

  if (!existing) {
    return {
      kind: 'created',
      history: historyEntry,
      record: {
        ...base,
        searchIds: [...new Set(offer.searchIds)].sort(),
        previousPrice: null,
        priceChange: null,
        priceChangePct: null,
        priceChangedAt: null,
        minPrice: offer.price,
        maxPrice: offer.price,
        firstSeenAt: now,
      },
    };
  }

  // Se conservan las etiquetas de busquedas que no corrieron, y de las que
  // si corrieron solo las que volvieron a encontrarlo. Unir sin quitar dejaba
  // productos colgando de una busqueda para siempre aunque se afinaran sus
  // reglas y ya no correspondieran.
  const kept = existing.searchIds.filter((id) => !ranSearchIds.has(id));
  const searchIds = [...new Set([...kept, ...offer.searchIds])].sort();
  const priceMoved = offer.price !== existing.price;

  const record: ProductRecord = {
    ...base,
    searchIds,
    firstSeenAt: existing.firstSeenAt,
    minPrice: Math.min(existing.minPrice, offer.price),
    maxPrice: Math.max(existing.maxPrice, offer.price),
    previousPrice: priceMoved ? existing.price : existing.previousPrice,
    priceChange: priceMoved ? offer.price - existing.price : existing.priceChange,
    priceChangePct: priceMoved
      ? changePercent(offer.price, existing.price)
      : existing.priceChangePct,
    priceChangedAt: priceMoved ? now : existing.priceChangedAt,
  };

  if (!priceMoved) {
    return { kind: 'unchanged', history: null, record };
  }

  return {
    kind: offer.price < existing.price ? 'drop' : 'rise',
    history: historyEntry,
    record,
  };
}
