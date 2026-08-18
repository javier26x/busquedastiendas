import * as cheerio from 'cheerio';
import type { AdapterContext, RawOffer, StoreAdapter } from '../types.js';
import { fetchHtml } from '../lib/http.js';
import { parseClp } from '../lib/money.js';
import { absoluteUrl, truncate } from '../lib/text.js';

/**
 * Adaptador para tiendas que renderizan sus resultados en el HTML.
 *
 * En vez de depender de selectores CSS (que cambian con cada rediseno) lee
 * los datos estructurados que las tiendas ya publican para Google:
 *   1. bloques JSON-LD (`schema.org/Product`), y
 *   2. el estado embebido de la SPA (`__NEXT_DATA__`, `__PRELOADED_STATE__`).
 *
 * Es best-effort: si la tienda cambia su estructura el adaptador devuelve
 * cero resultados y el runner lo reporta como fallo de esa tienda sin
 * afectar al resto.
 */
export interface HtmlStoreConfig {
  id: string;
  label: string;
  /**
   * URLs candidatas de busqueda, en orden de preferencia.
   *
   * Se prueban hasta que una devuelva productos. Las tiendas cambian sus
   * rutas de busqueda sin avisar y no siempre es evidente cual usan, asi
   * que se declaran varias y el adaptador descubre la correcta en vez de
   * depender de que la unica configurada siga vigente.
   */
  buildUrls: (query: string) => string[];
  /** Base para resolver enlaces relativos. */
  base: string;
  /** Arma el enlace cuando la tienda no lo publica en su estado embebido. */
  buildProductUrl?: (node: Record<string, unknown>) => string | null;
  enabled?: boolean;
}

/** Tras estos fallos totales seguidos, se deja de insistir durante la corrida. */
const MAX_CONSECUTIVE_FAILURES = 2;

export function createHtmlSearchAdapter(config: HtmlStoreConfig): StoreAdapter {
  // Estado por corrida: evita repetir el sondeo completo en cada consulta.
  let preferred = 0;
  let consecutiveFailures = 0;

  return {
    id: config.id,
    label: config.label,
    enabled: config.enabled ?? true,

    async search(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
      const urls = config.buildUrls(query);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error(
          `se omite: ninguna de las ${urls.length} URL candidatas respondio en los intentos previos`,
        );
      }

      // Se empieza por la que funciono la vez anterior; el resto queda de
      // respaldo, en su orden original.
      const order = [...new Set([preferred, ...urls.map((_url, index) => index)])];
      const failures: string[] = [];

      for (const index of order) {
        const url = urls[index];
        if (!url) continue;

        try {
          const html = await fetchHtml(url, { headers: { Referer: `${config.base}/` } });
          const $ = cheerio.load(html);
          const offers = extractStructuredOffers($, config.base, {
            ...(config.buildProductUrl ? { buildProductUrl: config.buildProductUrl } : {}),
          });

          if (offers.length > 0) {
            if (preferred !== index) {
              // Se registra cual funciono para poder podar las demas despues.
              ctx.log(`${config.label}: usando ${url}`);
              preferred = index;
            }
            consecutiveFailures = 0;
            return offers.slice(0, ctx.limit);
          }

          failures.push(`${url} -> sin datos estructurados`);
        } catch (error) {
          failures.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Solo si fallaron todas: una candidata mala no es noticia por si sola.
      consecutiveFailures += 1;
      throw new Error(`ninguna URL devolvio productos. ${failures.join(' | ')}`);
    },
  };
}

/**
 * Extrae ofertas de los datos estructurados de una pagina ya parseada.
 *
 * Se exporta para que otros adaptadores la usen como ultimo recurso cuando
 * sus selectores propios fallan: es la via que resulto mas resistente a los
 * cambios de maquetado de las tiendas.
 */
export interface ExtractOptions {
  /**
   * Construye el enlace del producto cuando el estado embebido no lo trae.
   *
   * Sodimac, por ejemplo, publica sus productos sin campo `url`: hay que
   * armarla desde el identificador.
   */
  buildProductUrl?: (node: Record<string, unknown>) => string | null;
}

export function extractStructuredOffers(
  $: cheerio.CheerioAPI,
  base: string,
  options: ExtractOptions = {},
): RawOffer[] {
  const fromJsonLd = extractFromJsonLd($, base);
  if (fromJsonLd.length > 0) return fromJsonLd;
  return extractFromEmbeddedState($, base, options);
}

/* ------------------------------------------------------------------ */
/* JSON-LD                                                             */
/* ------------------------------------------------------------------ */

function extractFromJsonLd($: cheerio.CheerioAPI, base: string): RawOffer[] {
  const offers: RawOffer[] = [];

  $('script[type="application/ld+json"]').each((_i, element) => {
    const raw = $(element).contents().text().trim();
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // Bloque malformado: lo ignoramos.
    }

    for (const node of collectProductNodes(parsed)) {
      const offer = jsonLdToOffer(node, base);
      if (offer) offers.push(offer);
    }
  });

  return dedupe(offers);
}

/** Recorre el JSON-LD juntando todo lo que parezca un Product. */
function collectProductNodes(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 8 || value === null || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectProductNodes(entry, depth + 1));
  }

  const node = value as Record<string, unknown>;
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];

  if (types.includes('Product')) return [node];

  // ItemList / @graph envuelven los productos.
  const containers = ['itemListElement', '@graph', 'item', 'mainEntity'];
  return containers.flatMap((key) =>
    key in node ? collectProductNodes(node[key], depth + 1) : [],
  );
}

function jsonLdToOffer(node: Record<string, unknown>, base: string): RawOffer | null {
  const title = asString(node['name']);
  if (!title) return null;

  const offerNode = firstOffer(node['offers']);
  const price = parseClp(
    asString(offerNode?.['price']) ??
      asString(offerNode?.['lowPrice']) ??
      (typeof offerNode?.['price'] === 'number' ? (offerNode['price'] as number) : null),
  );
  if (price === null) return null;

  const url = absoluteUrl(asString(node['url']) ?? asString(offerNode?.['url']), base);
  if (!url) return null;

  const externalId =
    asString(node['sku']) ??
    asString(node['productID']) ??
    asString(node['mpn']) ??
    urlFingerprint(url);

  const brandNode = node['brand'];
  const brand =
    asString(brandNode) ??
    (brandNode && typeof brandNode === 'object'
      ? asString((brandNode as Record<string, unknown>)['name'])
      : null);

  const availability = asString(offerNode?.['availability']) ?? '';

  return {
    externalId,
    title: truncate(title),
    url,
    image: firstImage(node['image'], base),
    brand,
    price,
    listPrice: null,
    currency: 'CLP',
    available: !/OutOfStock|SoldOut|Discontinued/i.test(availability),
  };
}

function firstOffer(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    const first = value.find((entry) => entry && typeof entry === 'object');
    return (first as Record<string, unknown>) ?? null;
  }
  return value as Record<string, unknown>;
}

function firstImage(value: unknown, base: string): string | null {
  if (typeof value === 'string') return absoluteUrl(value, base);
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string');
    return typeof first === 'string' ? absoluteUrl(first, base) : null;
  }
  if (value && typeof value === 'object') {
    return absoluteUrl(asString((value as Record<string, unknown>)['url']), base);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Estado embebido de la SPA                                           */
/* ------------------------------------------------------------------ */

const STATE_SELECTORS = ['script#__NEXT_DATA__', 'script[id="__NEXT_DATA__"]'];
const STATE_GLOBALS = ['__PRELOADED_STATE__', '__INITIAL_STATE__', '__APOLLO_STATE__'];

function extractFromEmbeddedState(
  $: cheerio.CheerioAPI,
  base: string,
  options: ExtractOptions,
): RawOffer[] {
  const blobs: unknown[] = [];

  for (const selector of STATE_SELECTORS) {
    const text = $(selector).first().contents().text().trim();
    if (text) {
      const parsed = safeParse(text);
      if (parsed !== undefined) blobs.push(parsed);
    }
  }

  if (blobs.length === 0) {
    const scripts = $('script:not([src])').toArray();
    for (const script of scripts) {
      const text = $(script).contents().text();
      for (const globalName of STATE_GLOBALS) {
        const marker = `${globalName}`;
        const index = text.indexOf(marker);
        if (index === -1) continue;
        const start = text.indexOf('{', index);
        if (start === -1) continue;
        const json = sliceBalancedJson(text, start);
        const parsed = json ? safeParse(json) : undefined;
        if (parsed !== undefined) blobs.push(parsed);
      }
    }
  }

  const offers = blobs.flatMap((blob) =>
    collectStateProducts(blob).flatMap((node) => {
      const offer = stateNodeToOffer(node, base, options);
      return offer ? [offer] : [];
    }),
  );

  return dedupe(offers);
}

/** Objetos que tienen nombre y algo que parece precio. */
function collectStateProducts(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 12 || value === null || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStateProducts(entry, depth + 1));
  }

  const node = value as Record<string, unknown>;
  const found: Record<string, unknown>[] = [];

  if (looksLikeProduct(node)) found.push(node);

  for (const child of Object.values(node)) {
    found.push(...collectStateProducts(child, depth + 1));
  }

  return found;
}

const NAME_KEYS = ['displayName', 'productName', 'productTitle', 'name', 'title', 'nombre'];

function looksLikeProduct(node: Record<string, unknown>): boolean {
  const hasName = NAME_KEYS.some((key) => {
    const value = node[key];
    return typeof value === 'string' && value.trim().length > 3;
  });
  if (!hasName) return false;
  return extractStatePrice(node) !== null;
}

/** Precios en estados embebidos aparecen en muchas formas distintas. */
function extractStatePrice(node: Record<string, unknown>): number | null {
  const direct = [
    'price',
    'currentPrice',
    'salePrice',
    'finalPrice',
    'bestPrice',
    'sellingPrice',
    'priceValue',
    'lowPrice',
    'precio',
  ];
  for (const key of direct) {
    const value = node[key];
    if (typeof value === 'number' || typeof value === 'string') {
      const parsed = parseClp(value);
      if (parsed !== null) return parsed;
    }
  }

  // Formato del grupo Falabella. Falabella publica `price: ["129.990"]` y
  // Sodimac `price: "7.990"` mas `priceWithoutFormatting: 7990`, que al ser
  // un numero limpio no depende de interpretar el separador de miles.
  const values = priceValues(node);
  return values.length > 0 ? Math.min(...values) : null;
}

/**
 * Precios que exigen un medio de pago concreto.
 *
 * Falabella y Sodimac publican junto al precio normal el de su tarjeta CMR,
 * que casi siempre es el mas bajo. Tomarlo como precio efectivo mostraria
 * uno que no paga quien no tiene esa tarjeta.
 */
const CONDITIONAL_PRICE = /cmr|tarjeta|falabella|socio|puntos/i;

/** Precios de un nodo, en pesos, sin los condicionados a un medio de pago. */
function priceValues(node: Record<string, unknown>): number[] {
  const prices = node['prices'];
  if (!Array.isArray(prices)) return [];

  return prices.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;

    const kind = `${asString(row['type']) ?? ''} ${asString(row['label']) ?? ''}`;
    if (CONDITIONAL_PRICE.test(kind)) return [];

    const clean = row['priceWithoutFormatting'];
    if (typeof clean === 'number' || typeof clean === 'string') {
      const parsed = parseClp(clean);
      if (parsed !== null) return [parsed];
    }

    const inner = row['price'];
    const candidate = Array.isArray(inner) ? inner[0] : inner;
    if (typeof candidate !== 'number' && typeof candidate !== 'string') return [];
    const parsed = parseClp(candidate);
    return parsed === null ? [] : [parsed];
  });
}

function stateNodeToOffer(
  node: Record<string, unknown>,
  base: string,
  options: ExtractOptions,
): RawOffer | null {
  const title = NAME_KEYS.map((key) => asString(node[key])).find(
    (value) => value && value.trim().length > 3,
  );
  if (!title) return null;

  const price = extractStatePrice(node);
  if (price === null) return null;

  // Algunas tiendas no publican el enlace en el estado: se arma desde el id.
  const url =
    absoluteUrl(
      asString(node['url']) ?? asString(node['productUrl']) ?? asString(node['link']),
      base,
    ) ?? absoluteUrl(options.buildProductUrl?.(node) ?? null, base);
  if (!url) return null;

  const externalId =
    asString(node['productId']) ??
    asString(node['skuId']) ??
    asString(node['sku']) ??
    asString(node['id']) ??
    urlFingerprint(url);

  const listPrice = collectListPrice(node);

  return {
    externalId,
    title: truncate(title),
    url,
    image: firstImage(node['image'] ?? node['mediaUrls'] ?? node['imageUrl'], base),
    brand: asString(node['brand']) ?? asString(node['brandName']),
    price,
    listPrice: listPrice !== null && listPrice > price ? listPrice : null,
    currency: 'CLP',
    available: node['available'] !== false && node['isAvailable'] !== false,
  };
}

/** Busca el precio "normal" (tachado) para poder inferir si hay oferta. */
function collectListPrice(node: Record<string, unknown>): number | null {
  const keys = ['listPrice', 'normalPrice', 'oldPrice', 'regularPrice', 'priceWithoutDiscount'];
  for (const key of keys) {
    const value = node[key];
    if (typeof value === 'number' || typeof value === 'string') {
      const parsed = parseClp(value);
      if (parsed !== null) return parsed;
    }
  }

  // Con varios precios (internet / normal / tarjeta) el mayor es el normal.
  const values = priceValues(node);
  return values.length > 1 ? Math.max(...values) : null;
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Corta el objeto JSON balanceado que empieza en `start`. */
function sliceBalancedJson(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Identificador estable derivado de la URL.
 *
 * Se usa la ruta completa y no el ultimo segmento: en las tiendas cuyas URL
 * terminan en `/p` (VTEX, Paris) ese segmento es el mismo para todos los
 * productos, y todos colapsarian en uno solo al deduplicar.
 */
function urlFingerprint(url: string): string {
  const path = (url.split('?')[0] ?? url).replace(/^https?:\/\/[^/]+/, '');
  const clean = path.replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
  return clean || url;
}

function dedupe(offers: RawOffer[]): RawOffer[] {
  const seen = new Map<string, RawOffer>();
  for (const offer of offers) {
    const existing = seen.get(offer.externalId);
    // Ante duplicados nos quedamos con el mas barato.
    if (!existing || offer.price < existing.price) seen.set(offer.externalId, offer);
  }
  return [...seen.values()];
}
