import type { AdapterContext, RawOffer, StoreAdapter } from '../types.js';
import { fetchJson } from '../lib/http.js';
import { parseClp } from '../lib/money.js';
import { truncate } from '../lib/text.js';

/**
 * Adaptador generico para tiendas montadas sobre VTEX.
 *
 * VTEX expone un catalogo publico y estable en
 * `/api/catalog_system/pub/products/search`, asi que una sola implementacion
 * sirve para cualquier tienda de la plataforma: basta registrar el host en
 * `config/stores.ts`.
 */
export interface VtexStoreConfig {
  id: string;
  label: string;
  /** Host sin protocolo, ej: "www.easy.cl". */
  host: string;
  enabled?: boolean;
}

interface VtexProduct {
  productId?: string;
  productName?: string;
  brand?: string | null;
  linkText?: string;
  link?: string;
  items?: VtexItem[];
}

interface VtexItem {
  itemId?: string;
  images?: { imageUrl?: string }[];
  sellers?: VtexSeller[];
}

interface VtexSeller {
  commertialOffer?: {
    Price?: number;
    ListPrice?: number;
    PriceWithoutDiscount?: number;
    IsAvailable?: boolean;
    AvailableQuantity?: number;
  };
}

/**
 * VTEX Intelligent Search.
 *
 * Es el buscador nuevo de VTEX. Varias tiendas ya migraron y dejaron el
 * catalogo clasico devolviendo vacio, asi que conviene tener las dos vias: el
 * producto viene con la misma forma, cambia solo la ruta y el envoltorio.
 */
export function createVtexIntelligentSearchAdapter(config: VtexStoreConfig): StoreAdapter {
  const base = `https://${config.host}`;

  return {
    id: config.id,
    label: config.label,
    enabled: config.enabled ?? true,

    async search(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
      const count = Math.max(1, Math.min(ctx.limit, 50));
      const url =
        `${base}/api/io/_v/api/intelligent-search/product_search` +
        `?query=${encodeURIComponent(query)}&count=${count}&page=1`;

      const payload = await fetchJson<{ products?: VtexProduct[] }>(url, {
        headers: { Referer: `${base}/` },
      });

      const products = payload?.products;
      if (!Array.isArray(products)) {
        ctx.log(`${config.label}: respuesta inesperada de intelligent-search`, { query });
        return [];
      }

      return products.flatMap((product) => toOffer(product, base));
    },
  };
}

export function createVtexAdapter(config: VtexStoreConfig): StoreAdapter {
  const base = `https://${config.host}`;

  return {
    id: config.id,
    label: config.label,
    enabled: config.enabled ?? true,

    async search(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
      const to = Math.max(0, Math.min(ctx.limit, 50) - 1);
      const url =
        `${base}/api/catalog_system/pub/products/search` +
        `?ft=${encodeURIComponent(query)}&_from=0&_to=${to}`;

      const products = await fetchJson<VtexProduct[]>(url, {
        headers: { Referer: `${base}/` },
      });

      if (!Array.isArray(products)) {
        ctx.log(`${config.label}: respuesta inesperada del catalogo VTEX`, { query });
        return [];
      }

      return products.flatMap((product) => toOffer(product, base));
    },
  };
}

function toOffer(product: VtexProduct, base: string): RawOffer[] {
  const externalId = product.productId?.trim();
  const title = product.productName?.trim();
  if (!externalId || !title) return [];

  // Nos quedamos con la oferta mas barata entre todos los SKU y vendedores.
  let best: { price: number; listPrice: number | null; available: boolean } | null = null;

  for (const item of product.items ?? []) {
    for (const seller of item.sellers ?? []) {
      const offer = seller.commertialOffer;
      if (!offer) continue;

      const price = parseClp(offer.Price ?? null);
      if (price === null) continue;

      const listPrice =
        parseClp(offer.ListPrice ?? null) ?? parseClp(offer.PriceWithoutDiscount ?? null);
      const available = offer.IsAvailable ?? (offer.AvailableQuantity ?? 0) > 0;

      // Preferimos disponible; a igualdad de disponibilidad, el mas barato.
      const better =
        best === null ||
        (available && !best.available) ||
        (available === best.available && price < best.price);

      if (better) best = { price, listPrice, available };
    }
  }

  if (!best) return [];

  const image = product.items?.[0]?.images?.[0]?.imageUrl ?? null;
  const url = product.link?.trim() || (product.linkText ? `${base}/${product.linkText}/p` : null);
  if (!url) return [];

  return [
    {
      externalId,
      title: truncate(title),
      url,
      image,
      brand: product.brand?.trim() || null,
      price: best.price,
      listPrice: best.listPrice,
      currency: 'CLP',
      available: best.available,
    },
  ];
}
