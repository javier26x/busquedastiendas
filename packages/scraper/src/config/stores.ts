import type { StoreAdapter } from '../types.js';
import { mercadoLibreAdapter } from '../adapters/mercadolibre.js';
import { createVtexAdapter } from '../adapters/vtex.js';
import { createHtmlSearchAdapter } from '../adapters/html-search.js';
import { createFallbackAdapter } from '../adapters/fallback.js';
import { createDomCardsAdapter } from '../adapters/dom-cards.js';
import { fixtureAdapter } from '../adapters/fixture.js';

const enc = encodeURIComponent;

/**
 * Tienda de la que no se sabe con certeza sobre que plataforma corre.
 *
 * Prueba el catalogo publico de VTEX y, si no aplica, la busqueda HTML con
 * varias rutas candidatas (incluida la de VTEX `?map=ft`). Asi una
 * suposicion equivocada sobre la plataforma no deja la tienda fuera.
 */
function createUnknownPlatformStore(config: {
  id: string;
  label: string;
  host: string;
  /** Rutas de busqueda propias, ademas de las genericas de VTEX. */
  paths?: (query: string) => string[];
  enabled?: boolean;
}): StoreAdapter {
  const base = `https://${config.host}`;

  return createFallbackAdapter({
    id: config.id,
    label: config.label,
    enabled: config.enabled ?? true,
    strategies: [
      createVtexAdapter({ id: `${config.id}-vtex`, label: config.label, host: config.host }),
      createHtmlSearchAdapter({
        id: `${config.id}-html`,
        label: config.label,
        base,
        buildUrls: (q) => [
          ...(config.paths?.(q) ?? []),
          // Rutas genericas de las plataformas mas usadas en retail chileno.
          `${base}/${enc(q)}?map=ft`, // VTEX
          `${base}/search?q=${enc(q)}`,
          `${base}/catalogsearch/result/?q=${enc(q)}`, // Magento
        ],
      }),
    ],
  });
}

/**
 * Registro de tiendas chilenas monitoreadas.
 *
 * Falabella es la referencia que funciona: expone sus productos en datos
 * estructurados y el adaptador HTML generico los lee sin problema. El resto
 * se declara con varias rutas candidatas porque no todas las plataformas son
 * conocidas de antemano; el log de cada corrida indica cual funciono.
 */
export const STORES: StoreAdapter[] = [
  // Bloqueada: la API exige token y el listado devuelve una interstitial de
  // 23 kB en vez de resultados. Se deja registrada para poder reintentarla.
  { ...mercadoLibreAdapter, enabled: false },

  // --- Grupo Falabella -----------------------------------------------------
  // Ambas corren sobre la misma plataforma: falabella.com/{tienda}-cl/search.
  createHtmlSearchAdapter({
    id: 'falabella',
    label: 'Falabella',
    base: 'https://www.falabella.com',
    buildUrls: (q) => [`https://www.falabella.com/falabella-cl/search?Ntt=${enc(q)}`],
  }),
  createHtmlSearchAdapter({
    id: 'sodimac',
    label: 'Sodimac',
    base: 'https://www.sodimac.cl',
    buildUrls: (q) => [`https://www.sodimac.cl/sodimac-cl/search?Ntt=${enc(q)}`],
    // Sodimac publica sus productos sin campo `url`, a diferencia de
    // Falabella: hay que armar el enlace desde el identificador.
    buildProductUrl: (node) => {
      const id = node['productId'] ?? node['skuId'];
      return typeof id === 'string' && id ? `https://www.sodimac.cl/sodimac-cl/product/${id}/` : null;
    },
  }),
  createHtmlSearchAdapter({
    id: 'tottus',
    label: 'Tottus',
    base: 'https://www.falabella.com',
    buildUrls: (q) => [`https://www.falabella.com/tottus-cl/search?Ntt=${enc(q)}`],
    enabled: false, // Supermercado: rara vez tiene estos productos.
  }),

  // --- Grupo Cencosud ------------------------------------------------------
  // Bloqueada por WAF: responde 403 en todas sus rutas, tambien desde
  // GitHub Actions. No es un problema de URL.
  createUnknownPlatformStore({
    id: 'easy',
    label: 'Easy',
    host: 'www.easy.cl',
    enabled: false,
    paths: (q) => [
      `https://www.easy.cl/search?q=${enc(q)}`,
      `https://www.easy.cl/busqueda?q=${enc(q)}`,
      `https://www.easy.cl/tienda/search?q=${enc(q)}`,
    ],
  }),
  // Paris renderiza los productos en el DOM y no deja ningun JSON util.
  createDomCardsAdapter({
    id: 'paris',
    label: 'Paris',
    base: 'https://www.paris.cl',
    buildUrls: (q) => [
      `https://www.paris.cl/search/?q=${enc(q)}`,
      `https://www.paris.cl/search?q=${enc(q)}`,
    ],
    cardSelectors: [
      '[data-testid="paris-vertical-pod"]',
      '[data-testid^="paris-vertical-pod"]',
      '[data-testid*="pod"]',
    ],
  }),

  // --- Otras tiendas -------------------------------------------------------
  // Bloqueada por WAF: 403 en todas sus rutas.
  createUnknownPlatformStore({
    id: 'ripley',
    label: 'Ripley',
    host: 'simple.ripley.cl',
    enabled: false,
    paths: (q) => [
      `https://simple.ripley.cl/search/${enc(q)}`,
      `https://simple.ripley.cl/search?q=${enc(q)}`,
    ],
  }),
  // Responde 200 pero sirve una pagina anti-bot, sin productos.
  createUnknownPlatformStore({
    id: 'lider',
    label: 'Lider',
    host: 'www.lider.cl',
    enabled: false,
    paths: (q) => [
      `https://www.lider.cl/catalogo/search?Ntt=${enc(q)}`,
      `https://www.lider.cl/search?query=${enc(q)}`,
    ],
  }),
  // Sin datos estructurados ni selectores reconocibles: carga por XHR.
  createUnknownPlatformStore({
    id: 'construmart',
    label: 'Construmart',
    host: 'www.construmart.cl',
    enabled: false,
  }),
  // Sin datos estructurados ni selectores reconocibles: carga por XHR.
  createUnknownPlatformStore({
    id: 'imperial',
    label: 'Imperial',
    host: 'www.imperial.cl',
    enabled: false,
  }),

  fixtureAdapter,
];

/** Tiendas activas por defecto. */
export function enabledStores(): StoreAdapter[] {
  return STORES.filter((store) => store.enabled);
}

/**
 * Resuelve la lista de tiendas segun `--stores=a,b`.
 * Permite activar explicitamente tiendas deshabilitadas (ej: `fixture`).
 */
export function resolveStores(requested: string[] | null): StoreAdapter[] {
  if (!requested || requested.length === 0) return enabledStores();

  const wanted = new Set(requested.map((id) => id.trim().toLowerCase()).filter(Boolean));
  const resolved = STORES.filter((store) => wanted.has(store.id));

  const unknown = [...wanted].filter((id) => !STORES.some((store) => store.id === id));
  if (unknown.length > 0) {
    throw new Error(
      `Tienda(s) desconocida(s): ${unknown.join(', ')}. Disponibles: ${STORES.map((s) => s.id).join(', ')}`,
    );
  }

  return resolved;
}
