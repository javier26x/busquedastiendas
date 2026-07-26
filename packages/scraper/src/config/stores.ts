import type { StoreAdapter } from '../types.js';
import { mercadoLibreAdapter } from '../adapters/mercadolibre.js';
import { createVtexAdapter } from '../adapters/vtex.js';
import { createHtmlSearchAdapter } from '../adapters/html-search.js';
import { fixtureAdapter } from '../adapters/fixture.js';

/**
 * Registro de tiendas chilenas monitoreadas.
 *
 * Para sumar una tienda VTEX basta agregar `createVtexAdapter({...})` con su
 * host. Para una tienda que renderiza en HTML, `createHtmlSearchAdapter`.
 * Si una tienda falla, el runner la marca como fallida y sigue con el resto.
 */
export const STORES: StoreAdapter[] = [
  mercadoLibreAdapter,

  // Tiendas sobre plataforma VTEX (catalogo publico y estable).
  createVtexAdapter({ id: 'easy', label: 'Easy', host: 'www.easy.cl' }),
  createVtexAdapter({ id: 'paris', label: 'Paris', host: 'www.paris.cl' }),

  // Tiendas que exponen los datos en el HTML (best-effort).
  createHtmlSearchAdapter({
    id: 'sodimac',
    label: 'Sodimac',
    base: 'https://www.sodimac.cl',
    buildUrl: (query) => `https://www.sodimac.cl/sodimac-cl/search?Ntt=${encodeURIComponent(query)}`,
  }),
  createHtmlSearchAdapter({
    id: 'falabella',
    label: 'Falabella',
    base: 'https://www.falabella.com',
    buildUrl: (query) =>
      `https://www.falabella.com/falabella-cl/search?Ntt=${encodeURIComponent(query)}`,
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
