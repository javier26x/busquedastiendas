/** Tipos del panel. Reflejan lo que el scraper escribe en Firestore. */

export interface Product {
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

  price: number;
  listPrice: number | null;
  isOffer: boolean;
  discountPct: number | null;

  previousPrice: number | null;
  priceChange: number | null;
  priceChangePct: number | null;
  priceChangedAt: Date | null;

  minPrice: number;
  maxPrice: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface SearchDoc {
  id: string;
  label: string;
  enabled: boolean;
}

export interface PricePoint {
  price: number;
  listPrice: number | null;
  isOffer: boolean;
  capturedAt: Date;
}

export interface StoreRunStat {
  storeId: string;
  storeLabel: string;
  ok: boolean;
  found: number;
  kept: number;
  error: string | null;
}

export interface RunDoc {
  runId: string;
  finishedAt: Date;
  status: 'ok' | 'partial' | 'error';
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
}
