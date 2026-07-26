/**
 * Tipos compartidos del scraper.
 *
 * `RawOffer` es lo que devuelve cada adaptador de tienda (datos crudos, ya
 * normalizados a un formato comun pero sin logica de negocio).
 * `ProductRecord` es lo que finalmente vive en Firestore.
 */

/** Definicion de una busqueda a monitorear (ej: "bodegas de jardin"). */
export interface SearchDefinition {
  /** Id estable, usado como clave en Firestore. */
  id: string;
  /** Nombre legible para la UI. */
  label: string;
  /** Terminos que se le mandan a cada tienda. Se consultan todos y se fusionan. */
  queries: string[];
  /** Reglas para descartar resultados irrelevantes que devuelve el buscador. */
  match: MatchRules;
  /** Si esta en false, el scraper la ignora. */
  enabled: boolean;
}

/**
 * Reglas de relevancia aplicadas sobre el titulo normalizado (sin tildes,
 * en minusculas). Los buscadores de las tiendas son ruidosos: pedir
 * "bodega de jardin" en Chile trae tambien bodegas de vino y servicios de
 * bodegaje, asi que filtramos.
 */
export interface MatchRules {
  /** El titulo debe contener al menos uno de cada grupo. */
  requireAll: string[][];
  /** Si el titulo contiene alguno de estos, se descarta. */
  exclude: string[];
}

/** Resultado crudo de un adaptador de tienda. */
export interface RawOffer {
  /** Id del producto dentro de la tienda (SKU, MLC id, etc). */
  externalId: string;
  title: string;
  url: string;
  image: string | null;
  brand: string | null;
  /** Precio efectivo a pagar hoy, en pesos chilenos (entero). */
  price: number;
  /** Precio normal/tachado si la tienda lo expone. */
  listPrice: number | null;
  currency: string;
  available: boolean;
  /** Algunas tiendas marcan la oferta explicitamente; si no, se infiere. */
  offerFlag?: boolean;
  /**
   * Permite atribuir la oferta a una tienda distinta del adaptador que la
   * encontro. Lo usan los fixtures y serviria para marketplaces con
   * multiples vendedores. Por defecto se usa el id del adaptador.
   */
  storeId?: string;
  storeLabel?: string;
}

/** Adaptador de tienda. */
export interface StoreAdapter {
  /** Id estable de la tienda (clave en Firestore y en filtros de la UI). */
  id: string;
  /** Nombre legible. */
  label: string;
  /** Si esta en false no se consulta salvo que se pida explicitamente. */
  enabled: boolean;
  /** Ejecuta una consulta y devuelve las ofertas crudas. */
  search(query: string, ctx: AdapterContext): Promise<RawOffer[]>;
}

/** Utilidades que el runner inyecta a cada adaptador. */
export interface AdapterContext {
  /** Maximo de resultados por consulta. */
  limit: number;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

/** Oferta ya normalizada y asociada a una busqueda. */
export interface NormalizedOffer extends RawOffer {
  storeId: string;
  storeLabel: string;
  searchIds: string[];
  /** Clave estable en Firestore: `${storeId}__${externalId}` saneado. */
  key: string;
  isOffer: boolean;
  discountPct: number | null;
}

/** Documento en la coleccion `products`. */
export interface ProductRecord {
  key: string;
  storeId: string;
  storeLabel: string;
  externalId: string;
  searchIds: string[];
  title: string;
  url: string;
  image: string | null;
  brand: string | null;
  currency: string;
  available: boolean;

  /** Precio efectivo actual. */
  price: number;
  /** Precio normal/tachado. */
  listPrice: number | null;
  isOffer: boolean;
  /** Descuento respecto al precio normal (0-100). */
  discountPct: number | null;

  /** Ultimo precio *distinto* observado. null si nunca cambio. */
  previousPrice: number | null;
  /** price - previousPrice. Negativo = bajo de precio. */
  priceChange: number | null;
  /** Variacion porcentual respecto a previousPrice. */
  priceChangePct: number | null;
  /** Cuando cambio el precio por ultima vez. */
  priceChangedAt: FirestoreDate | null;

  minPrice: number;
  maxPrice: number;
  firstSeenAt: FirestoreDate;
  lastSeenAt: FirestoreDate;
  lastRunId: string;
}

/** Alias para no acoplar los tipos al SDK de firebase-admin. */
export type FirestoreDate = Date;

/** Entrada del subcoleccion `products/{key}/history`. */
export interface PriceHistoryEntry {
  price: number;
  listPrice: number | null;
  isOffer: boolean;
  capturedAt: FirestoreDate;
  runId: string;
}

/** Resumen por tienda de una corrida. */
export interface StoreRunStat {
  storeId: string;
  storeLabel: string;
  ok: boolean;
  found: number;
  kept: number;
  error: string | null;
  durationMs: number;
}

/** Documento en la coleccion `runs`. */
export interface RunSummary {
  runId: string;
  startedAt: FirestoreDate;
  finishedAt: FirestoreDate;
  durationMs: number;
  status: 'ok' | 'partial' | 'error';
  dryRun: boolean;
  totals: {
    found: number;
    kept: number;
    created: number;
    updated: number;
    priceChanges: number;
    drops: number;
    rises: number;
  };
  stores: StoreRunStat[];
  errors: string[];
}
