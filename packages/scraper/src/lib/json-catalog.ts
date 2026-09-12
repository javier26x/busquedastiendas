import type { RawOffer } from '../types.js';
import { parseClp } from './money.js';
import { absoluteUrl, truncate } from './text.js';

/**
 * Extractor de productos desde un JSON de forma desconocida.
 *
 * Las tiendas que exponen su catalogo en JSON —una API propia, Shopify,
 * WooCommerce, o la respuesta XHR que se captura del navegador— no comparten
 * ni el envoltorio ni los nombres de los campos. En vez de escribir un
 * adaptador por cada una, aca se recorre la respuesta buscando objetos que
 * tengan nombre y precio, y para cada dato se prueban los nombres plausibles.
 *
 * Cada tienda ajusta lo que le es propio (que campo es el precio de verdad,
 * como se arma el enlace) por opciones, sin duplicar el recorrido.
 */

export interface JsonCatalogOptions {
  /** Base para resolver enlaces e imagenes relativas. */
  base: string;
  nameKeys?: string[];
  /** Claves del precio que paga cualquiera, en orden de preferencia. */
  priceKeys?: string[];
  /** Claves del precio tachado ("antes"). */
  listPriceKeys?: string[];
  idKeys?: string[];
  urlKeys?: string[];
  imageKeys?: string[];
  brandKeys?: string[];
  stockKeys?: string[];
  /** Claves que marcan la oferta explicitamente. */
  offerKeys?: string[];
  /**
   * Objetos o arreglos donde mirar los precios antes que en el propio nodo.
   * Un objeto agrupa variantes de pago del mismo producto; un arreglo agrupa
   * SKU distintos, y ahi se toma el mas barato.
   */
  priceContainers?: string[];
  /** Campos condicionados a un medio de pago: nunca son el precio. */
  conditionalPrice?: RegExp;
  /** Ajuste final del precio (ej: Woo lo publica en la unidad menor). */
  adjustPrice?: (price: number, node: Record<string, unknown>) => number | null;
  /** Enlace a la ficha cuando el nodo no trae ninguno. */
  buildProductUrl?: (node: Record<string, unknown>, id: string) => string | null;
}

/**
 * Precios que exigen pagar de cierta forma o ser cliente de un banco.
 *
 * Casi siempre son mas bajos que el normal, asi que tomarlos como precio del
 * producto prometeria una rebaja que no obtiene cualquiera. Se exporta porque
 * la misma distincion aparece en el HTML de las tiendas, no solo en su JSON.
 *
 * Hay dos nombres propios en la lista, y no sobran: varias tiendas etiquetan
 * el precio de su tarjeta con la marca y no con el medio de pago ("Precio
 * Falabella", "CMR").
 */
export const CONDITIONAL_PRICE =
  /efectivo|debito|credito|banco|tarjeta|cmr|falabella|socio|puntos|cuota/i;

const DEFAULTS = {
  nameKeys: [
    'nombre',
    'nombreProducto',
    'titulo',
    'displayName',
    'productName',
    'productTitle',
    'name',
    'title',
    'descripcionCorta',
    'descripcion',
  ],
  priceKeys: [
    'normal',
    'precioNormal',
    'precio',
    'valor',
    'price',
    'currentPrice',
    'salePrice',
    'finalPrice',
    'sellingPrice',
    'bestPrice',
  ],
  listPriceKeys: [
    'referencia',
    'precioReferencia',
    'precioAntes',
    'antes',
    'listPrice',
    'regular_price',
    'regularPrice',
    'normalPrice',
    'oldPrice',
    'compareAtPrice',
    'priceWithoutDiscount',
  ],
  idKeys: ['id', 'idProducto', 'codigo', 'codigoProducto', 'sku', 'productId', 'partNumber'],
  // Solo campos que son una URL de verdad. `handle` o `slug` son
  // identificadores: pegarlos a la base da un enlace roto que ademas le
  // ganaria al que arma bien la tienda con `buildProductUrl`.
  urlKeys: ['url', 'urlProducto', 'link', 'permalink'],
  imageKeys: [
    'imagen',
    'urlImagen',
    'imagenPrincipal',
    'image',
    'images',
    'thumbnail',
    'featured_image',
    'mediaUrls',
  ],
  brandKeys: ['marca', 'nombreMarca', 'brand', 'brandName', 'vendor'],
  stockKeys: ['stock', 'stockTotal', 'stockDisponible', 'disponible', 'tieneStock', 'available'],
  offerKeys: ['promocion', 'enPromocion', 'on_sale', 'isOffer', 'oferta'],
  priceContainers: ['precio', 'price', 'prices', 'pricing', 'variants', 'items', 'offers'],
  conditionalPrice: CONDITIONAL_PRICE,
} as const;

/** Profundidad maxima al recorrer el JSON, por si viene muy anidado. */
const MAX_DEPTH = 10;

/** Extrae las ofertas de una respuesta JSON, sea cual sea su envoltorio. */
export function extractJsonOffers(payload: unknown, options: JsonCatalogOptions): RawOffer[] {
  const config = withDefaults(options);

  const offers = collectProducts(payload, config).flatMap((node) => {
    const offer = toOffer(node, config);
    return offer ? [offer] : [];
  });

  return dedupe(offers);
}

type Config = Required<Omit<JsonCatalogOptions, 'adjustPrice' | 'buildProductUrl'>> &
  Pick<JsonCatalogOptions, 'adjustPrice' | 'buildProductUrl'>;

function withDefaults(options: JsonCatalogOptions): Config {
  return {
    ...DEFAULTS,
    nameKeys: options.nameKeys ?? [...DEFAULTS.nameKeys],
    priceKeys: options.priceKeys ?? [...DEFAULTS.priceKeys],
    listPriceKeys: options.listPriceKeys ?? [...DEFAULTS.listPriceKeys],
    idKeys: options.idKeys ?? [...DEFAULTS.idKeys],
    urlKeys: options.urlKeys ?? [...DEFAULTS.urlKeys],
    imageKeys: options.imageKeys ?? [...DEFAULTS.imageKeys],
    brandKeys: options.brandKeys ?? [...DEFAULTS.brandKeys],
    stockKeys: options.stockKeys ?? [...DEFAULTS.stockKeys],
    offerKeys: options.offerKeys ?? [...DEFAULTS.offerKeys],
    priceContainers: options.priceContainers ?? [...DEFAULTS.priceContainers],
    conditionalPrice: options.conditionalPrice ?? DEFAULTS.conditionalPrice,
    base: options.base,
    ...(options.adjustPrice ? { adjustPrice: options.adjustPrice } : {}),
    ...(options.buildProductUrl ? { buildProductUrl: options.buildProductUrl } : {}),
  };
}

function collectProducts(value: unknown, config: Config, depth = 0): Record<string, unknown>[] {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectProducts(entry, config, depth + 1));
  }

  const node = value as Record<string, unknown>;

  // Un producto no contiene otros productos: al reconocerlo se deja de bajar y
  // asi lo anidado (una variante, un accesorio sugerido) no se cuela como si
  // fuera otro resultado de la busqueda.
  if (nameOf(node, config) !== null && priceOf(node, config) !== null) return [node];

  return Object.values(node).flatMap((child) => collectProducts(child, config, depth + 1));
}

function nameOf(node: Record<string, unknown>, config: Config): string | null {
  for (const key of config.nameKeys) {
    const value = asString(node[key]);
    if (value && value.length > 3) return value;
  }
  return null;
}

function priceOf(node: Record<string, unknown>, config: Config): number | null {
  const raw = rawPriceOf(node, config);
  if (raw === null) return null;
  return config.adjustPrice ? config.adjustPrice(raw, node) : raw;
}

function rawPriceOf(node: Record<string, unknown>, config: Config): number | null {
  for (const source of priceSources(node, config)) {
    if (Array.isArray(source)) {
      // Varias variantes del mismo producto (SKU, tallas): la mas barata es la
      // que el usuario ve anunciada como "desde".
      const found = source.flatMap((entry) => {
        const inner = asObject(entry);
        const price = inner ? firstByKeys(inner, config.priceKeys) : null;
        return price === null ? [] : [price];
      });
      if (found.length > 0) return Math.min(...found);
      continue;
    }

    const direct = firstByKeys(source, config.priceKeys);
    if (direct !== null) return direct;
  }

  // Si la tienda renombra el campo, antes de dar el producto por perdido se
  // mira que mas hay en el contenedor de precios. Se descarta lo condicionado
  // y la referencia, y de lo que queda se toma el mayor: entre las variantes
  // de pago de un mismo producto, la que no exige nada es siempre la mas cara.
  for (const source of priceSources(node, config)) {
    if (Array.isArray(source) || source === node) continue;

    const candidates = Object.entries(source)
      .filter(([key]) => !config.conditionalPrice.test(key) && !config.listPriceKeys.includes(key))
      .flatMap(([, value]) => {
        const parsed = parseClp(asPrimitive(value));
        return parsed === null ? [] : [parsed];
      });

    if (candidates.length > 0) return Math.max(...candidates);
  }

  return null;
}

/** Contenedores de precio del nodo, y el nodo mismo como ultimo recurso. */
function priceSources(
  node: Record<string, unknown>,
  config: Config,
): (Record<string, unknown> | unknown[])[] {
  const sources: (Record<string, unknown> | unknown[])[] = [];

  for (const key of config.priceContainers) {
    const value = node[key];
    if (Array.isArray(value)) sources.push(value);
    else {
      const inner = asObject(value);
      if (inner) sources.push(inner);
    }
  }

  sources.push(node);
  return sources;
}

function listPriceOf(node: Record<string, unknown>, config: Config): number | null {
  const raw = rawListPriceOf(node, config);
  if (raw === null) return null;

  // El mismo ajuste que el precio vigente: si solo se aplicara a uno, el
  // tachado quedaria siempre mas alto e inventaria un descuento.
  return config.adjustPrice ? config.adjustPrice(raw, node) : raw;
}

function rawListPriceOf(node: Record<string, unknown>, config: Config): number | null {
  for (const source of priceSources(node, config)) {
    if (Array.isArray(source)) {
      const found = source.flatMap((entry) => {
        const inner = asObject(entry);
        const price = inner ? firstByKeys(inner, config.listPriceKeys) : null;
        return price === null ? [] : [price];
      });
      if (found.length > 0) return Math.max(...found);
      continue;
    }

    const direct = firstByKeys(source, config.listPriceKeys);
    if (direct !== null) return direct;
  }

  return null;
}

function firstByKeys(node: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const parsed = parseClp(asPrimitive(node[key]));
    if (parsed !== null) return parsed;
  }
  return null;
}

function idOf(node: Record<string, unknown>, config: Config): string | null {
  for (const key of config.idKeys) {
    const value = asPrimitive(node[key]);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    const text = asString(value);
    if (text) return text;
  }
  return null;
}

function urlOf(node: Record<string, unknown>, id: string, config: Config): string | null {
  for (const key of config.urlKeys) {
    const found = absoluteUrl(asString(node[key]), config.base);
    if (found) return found;
  }
  return absoluteUrl(config.buildProductUrl?.(node, id) ?? null, config.base);
}

function imageOf(node: Record<string, unknown>, config: Config): string | null {
  for (const key of config.imageKeys) {
    const value = node[key];

    const direct = absoluteUrl(asString(value), config.base);
    if (direct) return direct;

    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      const fromString = absoluteUrl(asString(entry), config.base);
      if (fromString) return fromString;

      const inner = asObject(entry);
      if (!inner) continue;
      const fromObject = absoluteUrl(
        asString(inner['url']) ?? asString(inner['src']) ?? asString(inner['imageUrl']),
        config.base,
      );
      if (fromObject) return fromObject;
    }
  }

  return null;
}

function brandOf(node: Record<string, unknown>, config: Config): string | null {
  for (const key of config.brandKeys) {
    const direct = asString(node[key]);
    if (direct) return direct;

    const inner = asObject(node[key]);
    const nested = inner ? (asString(inner['nombre']) ?? asString(inner['name'])) : null;
    if (nested) return nested;
  }
  return null;
}

/**
 * Disponibilidad.
 *
 * Ante la duda se asume disponible: esconder algo que si esta a la venta es
 * peor que el error contrario, porque el panel filtra por este campo.
 */
function availableOf(node: Record<string, unknown>, config: Config): boolean {
  for (const key of config.stockKeys) {
    const value = node[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
  }
  return true;
}

function offerFlagOf(node: Record<string, unknown>, config: Config): boolean | null {
  for (const source of [...priceSources(node, config)].filter(
    (entry): entry is Record<string, unknown> => !Array.isArray(entry),
  )) {
    for (const key of config.offerKeys) {
      const value = source[key];
      if (typeof value === 'boolean') return value;
    }
  }
  return null;
}

function toOffer(node: Record<string, unknown>, config: Config): RawOffer | null {
  const title = nameOf(node, config);
  const price = priceOf(node, config);
  if (!title || price === null) return null;

  const id = idOf(node, config);
  if (!id) return null;

  const url = urlOf(node, id, config);
  if (!url) return null;

  const listPrice = listPriceOf(node, config);
  const offerFlag = offerFlagOf(node, config);

  return {
    externalId: id,
    title: truncate(title),
    url,
    image: imageOf(node, config),
    brand: brandOf(node, config),
    price,
    // Un precio "antes" igual o menor al vigente no es rebaja, y mostrarlo
    // tachado seria enganoso.
    listPrice: listPrice !== null && listPrice > price ? listPrice : null,
    currency: 'CLP',
    available: availableOf(node, config),
    ...(offerFlag === null ? {} : { offerFlag }),
  };
}

/** La respuesta puede repetir un producto (destacados, relacionados). */
function dedupe(offers: RawOffer[]): RawOffer[] {
  const seen = new Map<string, RawOffer>();
  for (const offer of offers) {
    if (!seen.has(offer.externalId)) seen.set(offer.externalId, offer);
  }
  return [...seen.values()];
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asPrimitive(value: unknown): string | number | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

/** Para los logs: da una pista de por donde mirar si cambia el formato. */
export function topLevelKeys(payload: unknown): string {
  const node = asObject(payload);
  if (!node) return Array.isArray(payload) ? '(arreglo)' : typeof payload;
  return Object.keys(node).slice(0, 8).join(', ') || '(vacio)';
}
