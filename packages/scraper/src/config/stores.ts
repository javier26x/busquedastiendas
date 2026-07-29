import type { StoreAdapter } from '../types.js';
import { mercadoLibreAdapter } from '../adapters/mercadolibre.js';
import { createVtexAdapter } from '../adapters/vtex.js';
import { createHtmlSearchAdapter } from '../adapters/html-search.js';
import { createFallbackAdapter } from '../adapters/fallback.js';
import { createDomCardsAdapter } from '../adapters/dom-cards.js';
import { createBrowserAdapter } from '../adapters/browser.js';
import { fixtureAdapter } from '../adapters/fixture.js';

const enc = encodeURIComponent;

/**
 * Tienda de la que no se sabe con certeza sobre que plataforma corre.
 *
 * Prueba el catalogo publico de VTEX y, si no aplica, la busqueda HTML con
 * varias rutas candidatas (incluida la de VTEX `?map=ft`). Asi una
 * suposicion equivocada sobre la plataforma no deja la tienda fuera.
 */
/** Contenedores de tarjeta habituales, para el ultimo recurso por DOM. */
const GENERIC_CARD_SELECTORS = [
  '[data-testid*="pod"]',
  '[data-testid*="product-card"]',
  '[data-cnstrc-item="Product"]',
  'article[class*="product" i]',
  'li[class*="product" i]',
  'div[class*="product-card" i]',
];

function createUnknownPlatformStore(config: {
  id: string;
  label: string;
  host: string;
  /** Rutas de busqueda propias, ademas de las genericas de VTEX. */
  paths?: (query: string) => string[];
  enabled?: boolean;
}): StoreAdapter {
  const base = `https://${config.host}`;

  const buildUrls = (q: string): string[] => [
    ...(config.paths?.(q) ?? []),
    // Rutas genericas de las plataformas mas usadas en retail chileno.
    `${base}/${enc(q)}?map=ft`, // VTEX
    `${base}/search?q=${enc(q)}`,
    `${base}/catalogsearch/result/?q=${enc(q)}`, // Magento
  ];

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
        buildUrls,
      }),
      // Ultimo recurso: los productos estan en el DOM y no en un JSON, como
      // le pasa a Paris. Vale la pena intentarlo antes de dar la tienda por
      // perdida.
      createDomCardsAdapter({
        id: `${config.id}-dom`,
        label: config.label,
        base,
        buildUrls,
        cardSelectors: GENERIC_CARD_SELECTORS,
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
  // ikea.cl responde 403 a todo cliente HTTP y no esta en la plataforma de
  // Falabella (404). Se intenta con navegador, y el sitio global de respaldo.
  createBrowserAdapter({
    id: 'ikea',
    label: 'IKEA',
    base: 'https://www.ikea.cl',
    buildUrls: (q) => [
      `https://www.ikea.cl/search?q=${enc(q)}`,
      `https://www.ikea.com/cl/es/search/?q=${enc(q)}`,
    ],
    settleMs: 2500,
  }),
  createHtmlSearchAdapter({
    id: 'tottus',
    label: 'Tottus',
    base: 'https://www.falabella.com',
    buildUrls: (q) => [`https://www.falabella.com/tottus-cl/search?Ntt=${enc(q)}`],
    enabled: false, // Supermercado: rara vez tiene estos productos.
  }),

  // --- Grupo Cencosud ------------------------------------------------------
  // 403 a cualquier cliente HTTP; con navegador real puede pasar.
  createBrowserAdapter({
    id: 'easy',
    label: 'Easy',
    base: 'https://www.easy.cl',
    buildUrls: (q) => [
      `https://www.easy.cl/search?q=${enc(q)}`,
      `https://www.easy.cl/${enc(q)}?map=ft`,
    ],
  }),
  // Paris carga los productos por XHR: el HTML inicial trae las tarjetas
  // vacias, con 213 "skeleton". Necesita navegador.
  createBrowserAdapter({
    id: 'paris',
    label: 'Paris',
    base: 'https://www.paris.cl',
    buildUrls: (q) => [`https://www.paris.cl/search/?q=${enc(q)}`],
    cardSelectors: ['[data-testid^="paris-vertical-pod"]', '[data-testid*="pod"]'],
    waitForSelector: '[data-testid="paris-pod-price"]',
  }),

  // --- Otras tiendas -------------------------------------------------------
  // 403 en ambos dominios con las tres estrategias HTTP: bloqueo por huella
  // del cliente, que es justo lo que resuelve un navegador real.
  createBrowserAdapter({
    id: 'ripley',
    label: 'Ripley',
    base: 'https://simple.ripley.cl',
    buildUrls: (q) => [
      `https://simple.ripley.cl/search/${enc(q)}`,
      `https://www.ripley.cl/search/${enc(q)}`,
    ],
  }),
  // Servia una pagina anti-bot al cliente HTTP.
  createBrowserAdapter({
    id: 'lider',
    label: 'Lider',
    base: 'https://www.lider.cl',
    buildUrls: (q) => [`https://www.lider.cl/search?query=${enc(q)}`],
    settleMs: 2500,
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
