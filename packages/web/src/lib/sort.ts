import type { Product } from '../types.js';

/**
 * Ordenamiento y filtrado del listado.
 *
 * Es logica pura y sin dependencias de React ni de Firebase para poder
 * testearla directamente (ver `test/sort.test.ts`). El panel trae todos los
 * productos de una vez y ordena en el cliente: son cientos, no miles, y asi
 * se puede combinar cualquier orden con cualquier filtro sin depender de
 * indices compuestos en Firestore.
 */

export type SortKey =
  | 'precio-asc'
  | 'precio-desc'
  | 'variacion-baja'
  | 'variacion-alza'
  | 'descuento-desc'
  | 'oferta'
  | 'actualizado-desc';

export interface SortOption {
  key: SortKey;
  label: string;
  /** Texto corto para explicar el criterio en la UI. */
  hint: string;
}

export const SORT_OPTIONS: SortOption[] = [
  { key: 'precio-asc', label: 'Precio: menor a mayor', hint: 'Lo mas barato primero' },
  { key: 'precio-desc', label: 'Precio: mayor a menor', hint: 'Lo mas caro primero' },
  { key: 'variacion-baja', label: 'Variacion: mayores bajas', hint: 'Lo que mas bajo de precio' },
  { key: 'variacion-alza', label: 'Variacion: mayores alzas', hint: 'Lo que mas subio de precio' },
  { key: 'descuento-desc', label: 'Descuento: mayor a menor', hint: 'Mayor rebaja sobre el precio normal' },
  { key: 'oferta', label: 'En oferta primero', hint: 'Ofertas arriba, ordenadas por descuento' },
  { key: 'actualizado-desc', label: 'Actualizado recientemente', hint: 'Ultimo avistamiento' },
];

export interface Filters {
  /** Id de busqueda, o `null` para todas. */
  searchId: string | null;
  /** Ids de tienda; vacio significa todas. */
  storeIds: string[];
  onlyOffers: boolean;
  /** Solo productos cuyo ultimo cambio de precio fue una baja. */
  onlyDrops: boolean;
  onlyAvailable: boolean;
  /** Texto libre sobre titulo y marca. */
  query: string;
}

export const DEFAULT_FILTERS: Filters = {
  searchId: null,
  storeIds: [],
  onlyOffers: false,
  onlyDrops: false,
  onlyAvailable: false,
  query: '',
};

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function filterProducts(products: Product[], filters: Filters): Product[] {
  const needle = normalize(filters.query);
  const stores = new Set(filters.storeIds);

  return products.filter((product) => {
    if (filters.searchId && !product.searchIds.includes(filters.searchId)) return false;
    if (stores.size > 0 && !stores.has(product.storeId)) return false;
    if (filters.onlyOffers && !product.isOffer) return false;
    if (filters.onlyAvailable && !product.available) return false;
    if (filters.onlyDrops && !(product.priceChange !== null && product.priceChange < 0)) return false;

    if (needle) {
      const haystack = normalize(`${product.title} ${product.brand ?? ''} ${product.storeLabel}`);
      if (!haystack.includes(needle)) return false;
    }

    return true;
  });
}

/**
 * Compara dejando los `null` siempre al final, sin importar la direccion.
 * Un producto sin variacion conocida no deberia encabezar "mayores bajas".
 */
function compareNullable(
  a: number | null,
  b: number | null,
  direction: 'asc' | 'desc',
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === 'asc' ? a - b : b - a;
}

export function sortProducts(products: Product[], sortKey: SortKey): Product[] {
  const sorted = [...products];

  sorted.sort((a, b) => {
    switch (sortKey) {
      case 'precio-asc':
        return a.price - b.price;

      case 'precio-desc':
        return b.price - a.price;

      // Mas negativo = bajo mas, por eso ascendente.
      case 'variacion-baja':
        return compareNullable(a.priceChangePct, b.priceChangePct, 'asc') || a.price - b.price;

      case 'variacion-alza':
        return compareNullable(a.priceChangePct, b.priceChangePct, 'desc') || a.price - b.price;

      case 'descuento-desc':
        return compareNullable(a.discountPct, b.discountPct, 'desc') || a.price - b.price;

      case 'oferta': {
        if (a.isOffer !== b.isOffer) return a.isOffer ? -1 : 1;
        return compareNullable(a.discountPct, b.discountPct, 'desc') || a.price - b.price;
      }

      case 'actualizado-desc':
        return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();

      default:
        return 0;
    }
  });

  return sorted;
}

export interface Stats {
  total: number;
  offers: number;
  drops: number;
  rises: number;
  cheapest: Product | null;
  biggestDrop: Product | null;
}

/** Resumen para las tarjetas superiores del panel. */
export function computeStats(products: Product[]): Stats {
  let offers = 0;
  let drops = 0;
  let rises = 0;
  let cheapest: Product | null = null;
  let biggestDrop: Product | null = null;

  for (const product of products) {
    if (product.isOffer) offers += 1;

    if (product.priceChange !== null && product.priceChange < 0) {
      drops += 1;
      if (
        biggestDrop === null ||
        (product.priceChangePct ?? 0) < (biggestDrop.priceChangePct ?? 0)
      ) {
        biggestDrop = product;
      }
    }

    if (product.priceChange !== null && product.priceChange > 0) rises += 1;

    if (cheapest === null || product.price < cheapest.price) cheapest = product;
  }

  return { total: products.length, offers, drops, rises, cheapest, biggestDrop };
}

/** Lista de tiendas presentes, para armar el filtro. */
export function storeOptions(products: Product[]): { id: string; label: string; count: number }[] {
  const counts = new Map<string, { id: string; label: string; count: number }>();

  for (const product of products) {
    const existing = counts.get(product.storeId);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(product.storeId, { id: product.storeId, label: product.storeLabel, count: 1 });
    }
  }

  return [...counts.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'));
}
