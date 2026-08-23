import type { SearchDefinition } from '../types.js';

/**
 * Las busquedas que se monitorean.
 *
 * Para agregar una nueva basta con sumar un objeto aca: el scraper y la web
 * la toman automaticamente (la web lee la coleccion `searches` de Firestore,
 * que se sincroniza en cada corrida).
 */
export const SEARCHES: SearchDefinition[] = [
  {
    id: 'bodegas-jardin',
    label: 'Bodegas de jardin',
    queries: ['bodega de jardin', 'bodega jardin exterior', 'caseta jardin'],
    match: {
      requireAll: [
        ['bodega', 'caseta', 'cobertizo', 'galpon'],
        ['jardin', 'exterior', 'patio', 'terraza', 'aluminio', 'pvc', 'resina', 'metal', 'madera'],
      ],
      // En Chile "bodega" tambien es bodega de vinos y "bodegaje" un servicio.
      exclude: [
        'vino',
        'vinos',
        'cerveza',
        'bodegaje',
        'arriendo',
        'juguete',
        'miniatura',
        'maqueta',
        'sticker',
        'lego',
      ],
    },
    enabled: true,
  },
  {
    id: 'cajas-organizadoras',
    label: 'Cajas organizadoras',
    queries: ['caja organizadora', 'cajas organizadoras plasticas', 'caja organizadora con tapa'],
    match: {
      requireAll: [
        ['caja', 'cajas', 'organizador', 'organizadora', 'contenedor'],
        ['organizador', 'organizadora', 'almacenaje', 'almacenamiento', 'apilable', 'con tapa', 'plastic'],
      ],
      exclude: [
        'caja fuerte',
        // "herramienta" a secas: "caja de herramientas" no atrapaba
        // "Caja herramientas plastica", que es el titulo que usa Sodimac.
        'herramienta',
        'destornillador',
        'atornillador',
        'caja de carton',
        'caja registradora',
        'caja de cambios',
        'caja de fusibles',
        'organizador de cables',
        'juguete',
      ],
    },
    enabled: true,
  },
  {
    id: 'rexona-clinical',
    label: 'Rexona Clinical',
    queries: ['desodorante rexona clinical', 'rexona men clinical'],
    match: {
      // El titulo tiene que nombrar la marca y la linea: asi no entra
      // cualquier desodorante Rexona ni cualquier producto "clinical".
      requireAll: [['rexona'], ['clinical']],
      // Es un producto de supermercado, no de las tiendas de hogar. Se
      // descartan repuestos, accesorios y el ruido de marketplace.
      exclude: ['repuesto', 'estuche', 'neceser', 'bolso', 'toalla'],
    },
    enabled: true,
  },
];

/** Busca una definicion por id. */
export function getSearch(id: string): SearchDefinition | undefined {
  return SEARCHES.find((search) => search.id === id);
}

/** Solo las busquedas activas. */
export function enabledSearches(): SearchDefinition[] {
  return SEARCHES.filter((search) => search.enabled);
}
