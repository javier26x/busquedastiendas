import type { StoreAdapter } from '../types.js';
import { createJsonApiAdapter } from './json-api.js';

/**
 * Tiendas montadas sobre plataformas con catalogo JSON publico.
 *
 * Shopify y WooCommerce exponen su catalogo por una ruta fija que la tienda
 * rara vez sabe que tiene abierta, y que no depende del maquetado. Cuando una
 * tienda corre sobre alguna de las dos, esto es todo lo que hace falta: ni
 * selectores, ni navegador, ni mantenimiento cuando rediseñan el sitio.
 *
 * Para saber sobre que corre una tienda: `npm run diagnose -- --probe=host`.
 */

export interface PlatformStoreConfig {
  id: string;
  label: string;
  /** Host sin protocolo, ej: "www.tienda.cl". */
  host: string;
  enabled?: boolean;
}

/**
 * Shopify.
 *
 * `/search/suggest.json` es la busqueda predictiva del propio sitio. Devuelve
 * como mucho 10 productos, que para monitorear precios alcanza: lo que
 * interesa son los mas relevantes, no el catalogo entero.
 */
export function createShopifyAdapter(config: PlatformStoreConfig): StoreAdapter {
  const base = `https://${config.host}`;

  return createJsonApiAdapter({
    id: config.id,
    label: config.label,
    base,
    enabled: config.enabled ?? true,
    buildUrls: (query, limit) => [
      `${base}/search/suggest.json?q=${encodeURIComponent(query)}` +
        `&resources[type]=product&resources[limit]=${Math.min(limit, 10)}`,
      `${base}/search?q=${encodeURIComponent(query)}&view=json`,
    ],
    catalog: {
      priceKeys: ['price'],
      listPriceKeys: ['compare_at_price', 'compareAtPrice'],
      // `available` viene como booleano en cada producto.
      stockKeys: ['available'],
      // El enlace llega relativo ("/products/x") y `handle` es el mismo dato
      // sin la ruta; se arma por si el tema no publica `url`.
      buildProductUrl: (node) =>
        typeof node['handle'] === 'string' ? `${base}/products/${node['handle']}` : null,
    },
  });
}

/**
 * WooCommerce, por su Store API.
 *
 * Es la API que usa el propio carrito de la tienda, publica y sin token. Los
 * precios vienen en la unidad menor de la moneda, asi que hay que dividir
 * segun `currency_minor_unit` (en pesos suele ser 0, pero no siempre).
 */
export function createWooCommerceAdapter(config: PlatformStoreConfig): StoreAdapter {
  const base = `https://${config.host}`;

  return createJsonApiAdapter({
    id: config.id,
    label: config.label,
    base,
    enabled: config.enabled ?? true,
    buildUrls: (query, limit) => [
      `${base}/wp-json/wc/store/v1/products?search=${encodeURIComponent(query)}&per_page=${Math.min(limit, 50)}`,
      `${base}/wp-json/wc/store/products?search=${encodeURIComponent(query)}&per_page=${Math.min(limit, 50)}`,
    ],
    catalog: {
      priceKeys: ['price'],
      listPriceKeys: ['regular_price'],
      priceContainers: ['prices'],
      stockKeys: ['is_in_stock'],
      offerKeys: ['on_sale'],
      adjustPrice: (price, node) => {
        const minor = minorUnit(node);
        return minor > 0 ? Math.round(price / 10 ** minor) : price;
      },
    },
  });
}

function minorUnit(node: Record<string, unknown>): number {
  const prices = node['prices'];
  if (!prices || typeof prices !== 'object') return 0;

  const value = (prices as Record<string, unknown>)['currency_minor_unit'];
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
