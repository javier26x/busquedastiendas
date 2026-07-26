import * as cheerio from 'cheerio';
import type { AdapterContext, RawOffer, StoreAdapter } from '../types.js';
import { fetchHtml, fetchJson, HttpError } from '../lib/http.js';
import { parseClp } from '../lib/money.js';
import { absoluteUrl, truncate } from '../lib/text.js';

const SITE_ID = 'MLC'; // Mercado Libre Chile
const API_BASE = 'https://api.mercadolibre.com';
const WEB_BASE = 'https://listado.mercadolibre.cl';

interface MlApiResponse {
  results?: MlApiResult[];
}

interface MlApiResult {
  id?: string;
  title?: string;
  price?: number;
  original_price?: number | null;
  permalink?: string;
  thumbnail?: string;
  available_quantity?: number;
  attributes?: { id?: string; value_name?: string | null }[];
}

/**
 * Mercado Libre Chile.
 *
 * Intenta primero la API publica de busqueda; si responde 401/403 (Mercado
 * Libre la fue cerrando y hoy suele exigir token) cae al scraping del
 * listado HTML, que sigue siendo publico.
 */
export const mercadoLibreAdapter: StoreAdapter = {
  id: 'mercadolibre',
  label: 'Mercado Libre',
  enabled: true,

  async search(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
    try {
      const offers = await searchViaApi(query, ctx);
      if (offers.length > 0) return offers;
      ctx.log('API de Mercado Libre sin resultados, probando HTML', { query });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : undefined;
      ctx.log('API de Mercado Libre no disponible, usando HTML', {
        query,
        status,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return searchViaHtml(query, ctx);
  },
};

async function searchViaApi(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
  const url = `${API_BASE}/sites/${SITE_ID}/search?q=${encodeURIComponent(query)}&limit=${ctx.limit}`;
  const data = await fetchJson<MlApiResponse>(url, { retries: 1 });
  const results = data.results ?? [];

  return results.flatMap((item): RawOffer[] => {
    const price = parseClp(item.price ?? null);
    const externalId = item.id?.trim();
    const title = item.title?.trim();
    const url2 = item.permalink?.trim();

    if (!externalId || !title || !url2 || price === null) return [];

    const brand =
      item.attributes?.find((attr) => attr.id === 'BRAND')?.value_name?.trim() ?? null;

    return [
      {
        externalId,
        title: truncate(title),
        url: url2,
        image: item.thumbnail ?? null,
        brand,
        price,
        listPrice: parseClp(item.original_price ?? null),
        currency: 'CLP',
        available: (item.available_quantity ?? 1) > 0,
      },
    ];
  });
}

/** Selectores probados en orden; Mercado Libre renombra sus clases seguido. */
const ITEM_SELECTORS = [
  'li.ui-search-layout__item',
  'div.ui-search-result__wrapper',
  'div.poly-card',
];
const TITLE_SELECTORS = [
  'a.poly-component__title',
  '.poly-component__title',
  'h2.ui-search-item__title',
  '.ui-search-item__title',
  'h2',
  'h3',
];

async function searchViaHtml(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
  const slug = encodeURIComponent(query.trim().replace(/\s+/g, '-'));
  const url = `${WEB_BASE}/${slug}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const items = ITEM_SELECTORS.map((selector) => $(selector)).find((set) => set.length > 0);
  if (!items || items.length === 0) {
    ctx.log('Mercado Libre: el HTML no coincidio con ningun selector conocido', { query, url });
    return [];
  }

  const offers: RawOffer[] = [];

  items.slice(0, ctx.limit).each((_index, element) => {
    const node = $(element);

    const titleNode = TITLE_SELECTORS.map((selector) => node.find(selector).first()).find(
      (found) => found.length > 0 && found.text().trim().length > 0,
    );
    const title = titleNode?.text().trim();
    if (!title) return;

    // El enlace del producto siempre apunta a /MLC-xxxxx o articulo.mercadolibre.cl
    const href =
      node
        .find('a[href]')
        .toArray()
        .map((anchor) => $(anchor).attr('href') ?? '')
        .find((candidate) => /MLC-?\d+/i.test(candidate)) ?? node.find('a[href]').first().attr('href');

    const productUrl = absoluteUrl(href, WEB_BASE);
    if (!productUrl) return;

    const externalId = extractMlId(productUrl);
    if (!externalId) return;

    // El primer monto es el precio vigente; el que va dentro de <s> es el normal.
    const price = parseClp(node.find('.andes-money-amount__fraction').first().text());
    if (price === null) return;

    const listPriceText = node
      .find('s .andes-money-amount__fraction, .andes-money-amount--previous .andes-money-amount__fraction')
      .first()
      .text();

    offers.push({
      externalId,
      title: truncate(title),
      url: productUrl.split('?')[0] ?? productUrl,
      image:
        node.find('img').first().attr('data-src') ?? node.find('img').first().attr('src') ?? null,
      brand: null,
      price,
      listPrice: parseClp(listPriceText),
      currency: 'CLP',
      available: true,
    });
  });

  return offers;
}

/** Extrae el identificador MLC del enlace del producto. */
function extractMlId(url: string): string | null {
  const match = /(MLC-?\d+)/i.exec(url);
  if (!match?.[1]) return null;
  return match[1].toUpperCase().replace('-', '');
}
