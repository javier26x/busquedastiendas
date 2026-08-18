import type { AdapterContext, RawOffer, StoreAdapter } from '../types.js';
import { fetchJson } from '../lib/http.js';
import { parseClp } from '../lib/money.js';
import { absoluteUrl, slugify, truncate } from '../lib/text.js';

/**
 * PC Factory, leida por su API REST interna de catalogo.
 *
 * Es la via mas barata de todas las que usa este proyecto: un JSON sin
 * autenticacion, sin WAF y sin navegador de por medio. A diferencia de VTEX
 * no es una plataforma compartida, asi que el adaptador es propio.
 *
 * La forma exacta del JSON no esta documentada y puede cambiar sin aviso, de
 * modo que la extraccion no asume una ruta fija: recorre la respuesta
 * buscando objetos que tengan nombre y precio. Lo unico especifico de la
 * tienda es como se elige el precio (ver PAYMENT_PRICES).
 */

const API = 'https://api.pcfactory.cl/pcfactory-services-catalogo/v1/catalogo';
const SITE = 'https://www.pcfactory.cl';

/** La API ignora `size` por encima de esto y devuelve 48 igual. */
const MAX_PAGE_SIZE = 48;

export interface PcFactoryConfig {
  id?: string;
  label?: string;
  enabled?: boolean;
}

export function createPcFactoryAdapter(config: PcFactoryConfig = {}): StoreAdapter {
  const label = config.label ?? 'PC Factory';

  return {
    id: config.id ?? 'pcfactory',
    label,
    enabled: config.enabled ?? true,

    async search(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
      const size = Math.min(Math.max(ctx.limit, 1), MAX_PAGE_SIZE);
      const url = `${API}/productos?search=${encodeURIComponent(query)}&size=${size}`;

      const payload = await fetchJson<unknown>(url, {
        headers: { Referer: `${SITE}/`, Origin: SITE },
      });

      const offers = extractPcFactoryOffers(payload);

      if (offers.length === 0) {
        // Sin esto, un cambio de formato del JSON se ve igual que "la tienda
        // no vende nada parecido", y la tienda quedaria muda sin que se note.
        ctx.log(`${label}: la API respondio pero no se reconocio ningun producto`, {
          query,
          claves: topLevelKeys(payload),
        });
      }

      return offers.slice(0, ctx.limit);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Extraccion                                                          */
/* ------------------------------------------------------------------ */

/** Extrae las ofertas de la respuesta, sea cual sea el envoltorio. */
export function extractPcFactoryOffers(payload: unknown): RawOffer[] {
  const offers = collectProducts(payload).flatMap((node) => {
    const offer = toOffer(node);
    return offer ? [offer] : [];
  });

  return dedupe(offers);
}

/** Profundidad maxima al recorrer el JSON, por si viene muy anidado. */
const MAX_DEPTH = 8;

function collectProducts(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectProducts(entry, depth + 1));
  }

  const node = value as Record<string, unknown>;

  // Un producto no contiene otros productos: al reconocerlo se deja de bajar
  // y asi un objeto anidado (accesorio sugerido, bundle) no se cuela como si
  // fuera un resultado mas de la busqueda.
  if (looksLikeProduct(node)) return [node];

  return Object.values(node).flatMap((child) => collectProducts(child, depth + 1));
}

const NAME_KEYS = [
  'nombre',
  'nombreProducto',
  'titulo',
  'descripcionCorta',
  'descripcion',
  'name',
  'title',
  'displayName',
];

function looksLikeProduct(node: Record<string, unknown>): boolean {
  return nameOf(node) !== null && priceOf(node) !== null;
}

function nameOf(node: Record<string, unknown>): string | null {
  for (const key of NAME_KEYS) {
    const value = asString(node[key]);
    if (value && value.length > 3) return value;
  }
  return null;
}

/**
 * Precios que exigen un medio de pago concreto.
 *
 * PC Factory publica varios: `normal`, `efectivo`, `debito` y `bancoEstado`.
 * Los tres ultimos dependen de como pagues o de con que banco, y son mas
 * bajos; guardarlos como precio del producto prometeria una rebaja que no
 * obtiene cualquiera. Es el mismo criterio que ya se aplica al precio CMR de
 * Falabella y Sodimac.
 */
const PAYMENT_PRICES = /efectivo|debito|banco|tarjeta|credito|cuota/i;

/** El precio que paga cualquiera, sin condiciones. */
const PRICE_KEYS = ['normal', 'precioNormal', 'precio', 'valor', 'price'];

/** El precio "antes", tachado. En PC Factory se llama referencia. */
const LIST_PRICE_KEYS = ['referencia', 'precioReferencia', 'listPrice', 'antes'];

function priceOf(node: Record<string, unknown>): number | null {
  const precio = asObject(node['precio']);

  // El objeto `precio` es la fuente buena; los campos sueltos del producto
  // son el respaldo por si la API los mueve de lugar.
  for (const source of [precio, node]) {
    if (!source) continue;
    for (const key of PRICE_KEYS) {
      const parsed = parseClp(asPrimitive(source[key]));
      if (parsed !== null) return parsed;
    }
  }

  // Si renombran el campo, antes de dar el producto por perdido se mira que
  // mas hay dentro de `precio`. Se descartan los precios condicionados y la
  // referencia, y de lo que queda se toma el mayor: entre las variantes de un
  // mismo producto, la que no exige nada a cambio es siempre la mas cara.
  if (!precio) return null;

  const candidates = Object.entries(precio)
    .filter(([key]) => !PAYMENT_PRICES.test(key) && !LIST_PRICE_KEYS.includes(key))
    .flatMap(([, value]) => {
      const parsed = parseClp(asPrimitive(value));
      return parsed === null ? [] : [parsed];
    });

  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function listPriceOf(node: Record<string, unknown>): number | null {
  const precio = asObject(node['precio']);

  for (const source of [precio, node]) {
    if (!source) continue;
    for (const key of LIST_PRICE_KEYS) {
      const parsed = parseClp(asPrimitive(source[key]));
      if (parsed !== null) return parsed;
    }
  }

  return null;
}

const ID_KEYS = ['id', 'idProducto', 'codigo', 'codigoProducto', 'sku', 'partNumber'];

function idOf(node: Record<string, unknown>): string | null {
  for (const key of ID_KEYS) {
    const value = asPrimitive(node[key]);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    const text = asString(value);
    if (text) return text;
  }
  return null;
}

const URL_KEYS = ['url', 'urlProducto', 'link', 'permalink', 'slug'];

/**
 * Enlace a la ficha.
 *
 * Si la API no lo trae, se arma desde el id. PC Factory rutea por el id
 * numerico, asi que el nombre que va detras es solo cosmetico.
 */
function urlOf(node: Record<string, unknown>, id: string): string | null {
  for (const key of URL_KEYS) {
    const found = absoluteUrl(asString(node[key]), SITE);
    if (found) return found;
  }

  const name = nameOf(node);
  return name ? `${SITE}/producto/${id}-${slugify(name)}` : `${SITE}/producto/${id}`;
}

const IMAGE_KEYS = ['imagen', 'urlImagen', 'imagenPrincipal', 'image', 'thumbnail'];

function imageOf(node: Record<string, unknown>): string | null {
  for (const key of IMAGE_KEYS) {
    const direct = absoluteUrl(asString(node[key]), SITE);
    if (direct) return direct;

    // Tambien se acepta una lista de imagenes o de objetos con url.
    const value = node[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      const fromString = absoluteUrl(asString(entry), SITE);
      if (fromString) return fromString;

      const inner = asObject(entry);
      if (!inner) continue;
      const fromObject = absoluteUrl(asString(inner['url']) ?? asString(inner['src']), SITE);
      if (fromObject) return fromObject;
    }
  }

  return null;
}

const BRAND_KEYS = ['marca', 'nombreMarca', 'brand'];

function brandOf(node: Record<string, unknown>): string | null {
  for (const key of BRAND_KEYS) {
    const direct = asString(node[key]);
    if (direct) return direct;

    const inner = asObject(node[key]);
    const nested = inner ? (asString(inner['nombre']) ?? asString(inner['name'])) : null;
    if (nested) return nested;
  }
  return null;
}

const STOCK_KEYS = ['stock', 'stockTotal', 'stockDisponible', 'disponible', 'tieneStock'];

/**
 * Disponibilidad.
 *
 * Ante la duda se asume disponible: marcar como agotado algo que no lo esta
 * lo esconde de los filtros del panel, que es peor que el error contrario.
 */
function availableOf(node: Record<string, unknown>): boolean {
  for (const key of STOCK_KEYS) {
    const value = node[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
  }
  return true;
}

function toOffer(node: Record<string, unknown>): RawOffer | null {
  const title = nameOf(node);
  const price = priceOf(node);
  if (!title || price === null) return null;

  const id = idOf(node);
  if (!id) return null;

  const url = urlOf(node, id);
  if (!url) return null;

  const listPrice = listPriceOf(node);
  const precio = asObject(node['precio']);
  const promocion = precio?.['promocion'] ?? node['promocion'] ?? node['enPromocion'];

  return {
    externalId: id,
    title: truncate(title),
    url,
    image: imageOf(node),
    brand: brandOf(node),
    price,
    // Una "referencia" igual o menor al precio vigente no es rebaja. Importa
    // aca mas que en otras tiendas: es justo el numero que se infla antes de
    // un Cyber para simular un descuento.
    listPrice: listPrice !== null && listPrice > price ? listPrice : null,
    currency: 'CLP',
    available: availableOf(node),
    ...(typeof promocion === 'boolean' ? { offerFlag: promocion } : {}),
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

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asPrimitive(value: unknown): string | number | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

/** Para el log: da una pista de por donde mirar si cambia el formato. */
function topLevelKeys(payload: unknown): string {
  const node = asObject(payload);
  if (!node) return Array.isArray(payload) ? '(arreglo)' : typeof payload;
  return Object.keys(node).slice(0, 8).join(', ') || '(vacio)';
}
