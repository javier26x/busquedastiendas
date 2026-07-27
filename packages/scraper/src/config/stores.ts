import type { StoreAdapter } from '../types.js';
import { mercadoLibreAdapter } from '../adapters/mercadolibre.js';
import { createVtexAdapter } from '../adapters/vtex.js';
import { createHtmlSearchAdapter } from '../adapters/html-search.js';
import { createFallbackAdapter } from '../adapters/fallback.js';
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
  mercadoLibreAdapter,

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
    base: 'https://www.falabella.com',
    buildUrls: (q) => [
      // Sodimac migro al dominio del grupo, donde Falabella si responde.
      `https://www.falabella.com/sodimac-cl/search?Ntt=${enc(q)}`,
      `https://www.sodimac.cl/sodimac-cl/search?Ntt=${enc(q)}`,
      `https://www.sodimac.cl/sodimac-cl/search/?Ntt=${enc(q)}`,
    ],
  }),
  createHtmlSearchAdapter({
    id: 'tottus',
    label: 'Tottus',
    base: 'https://www.falabella.com',
    buildUrls: (q) => [`https://www.falabella.com/tottus-cl/search?Ntt=${enc(q)}`],
    enabled: false, // Supermercado: rara vez tiene estos productos.
  }),

  // --- Grupo Cencosud ------------------------------------------------------
  createUnknownPlatformStore({
    id: 'easy',
    label: 'Easy',
    host: 'www.easy.cl',
    paths: (q) => [
      `https://www.easy.cl/search?q=${enc(q)}`,
      `https://www.easy.cl/busqueda?q=${enc(q)}`,
      `https://www.easy.cl/tienda/search?q=${enc(q)}`,
    ],
  }),
  createUnknownPlatformStore({
    id: 'paris',
    label: 'Paris',
    host: 'www.paris.cl',
    paths: (q) => [
      `https://www.paris.cl/search/?q=${enc(q)}`,
      `https://www.paris.cl/search?q=${enc(q)}`,
      `https://www.paris.cl/busqueda?q=${enc(q)}`,
    ],
  }),

  // --- Otras tiendas -------------------------------------------------------
  createUnknownPlatformStore({
    id: 'ripley',
    label: 'Ripley',
    host: 'simple.ripley.cl',
    paths: (q) => [
      `https://simple.ripley.cl/search/${enc(q)}`,
      `https://simple.ripley.cl/search?q=${enc(q)}`,
    ],
  }),
  createUnknownPlatformStore({
    id: 'lider',
    label: 'Lider',
    host: 'www.lider.cl',
    paths: (q) => [
      `https://www.lider.cl/catalogo/search?Ntt=${enc(q)}`,
      `https://www.lider.cl/search?query=${enc(q)}`,
    ],
  }),
  createUnknownPlatformStore({
    id: 'construmart',
    label: 'Construmart',
    host: 'www.construmart.cl',
  }),
  createUnknownPlatformStore({
    id: 'imperial',
    label: 'Imperial',
    host: 'www.imperial.cl',
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
