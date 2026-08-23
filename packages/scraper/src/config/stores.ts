import type { StoreAdapter } from '../types.js';
import { mercadoLibreAdapter } from '../adapters/mercadolibre.js';
import { createVtexAdapter, createVtexIntelligentSearchAdapter } from '../adapters/vtex.js';
import { createHtmlSearchAdapter } from '../adapters/html-search.js';
import { createFallbackAdapter } from '../adapters/fallback.js';
import { createDomCardsAdapter } from '../adapters/dom-cards.js';
import { createBrowserAdapter } from '../adapters/browser.js';
import { createPcFactoryAdapter } from '../adapters/pcfactory.js';
import { createUnimarcAdapter } from '../adapters/unimarc.js';
import { createShopifyAdapter, createWooCommerceAdapter } from '../adapters/platform.js';
import { fixtureAdapter } from '../adapters/fixture.js';

const enc = encodeURIComponent;

/**
 * Tienda de la que no se sabe con certeza sobre que plataforma corre.
 *
 * Prueba las tecnicas en orden de coste, de un JSON publico a raspar el DOM,
 * y recuerda la que funciono. Asi una suposicion equivocada sobre la
 * plataforma no deja la tienda fuera, y basta declarar el host para empezar.
 *
 * Para saber de antemano cual aplica: `npm run diagnose -- --probe=host`.
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
    // Varias tiendas chilenas ruteen en español y devuelven 404 en /search.
    // Fue el motivo de que Jumbo, Santa Isabel y Unimarc parecieran caidas.
    `${base}/busqueda?q=${enc(q)}`,
    `${base}/buscar?q=${enc(q)}`,
    `${base}/search?query=${enc(q)}`,
    `${base}/catalogsearch/result/?q=${enc(q)}`, // Magento
  ];

  const platform = { label: config.label, host: config.host };

  return createFallbackAdapter({
    id: config.id,
    label: config.label,
    enabled: config.enabled ?? true,
    strategies: [
      // 1. Catalogos JSON publicos: una peticion, sin HTML que interpretar.
      createVtexAdapter({ ...platform, id: `${config.id}-vtex` }),
      createVtexIntelligentSearchAdapter({ ...platform, id: `${config.id}-vtex-is` }),
      createShopifyAdapter({ ...platform, id: `${config.id}-shopify` }),
      createWooCommerceAdapter({ ...platform, id: `${config.id}-woo` }),
      // 2. Datos estructurados dentro del HTML.
      createHtmlSearchAdapter({
        id: `${config.id}-html`,
        label: config.label,
        base,
        buildUrls,
      }),
      // 3. Ultimo recurso sin navegador: raspar las tarjetas del DOM.
      createDomCardsAdapter({
        id: `${config.id}-dom`,
        label: config.label,
        base,
        buildUrls,
        cardSelectors: GENERIC_CARD_SELECTORS,
      }),
      // 4. Navegador, que ademas captura el XHR. Es lo que necesitan las
      // tiendas que responden 200 con el HTML vacio y traen sus productos
      // por detras: Jumbo, Santa Isabel, Unimarc y Ahumada son de ese tipo.
      // Va al final porque cuesta segundos por consulta, pero la estrategia
      // que funciona queda recordada y las siguientes van directo a ella.
      createBrowserAdapter({
        id: `${config.id}-browser`,
        label: config.label,
        base,
        buildUrls,
        cardSelectors: GENERIC_CARD_SELECTORS,
        settleMs: 2500,
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
    base: 'https://www.ikea.com',
    buildUrls: (q) => [`https://www.ikea.com/cl/es/search/?q=${enc(q)}`],
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
  // 403 a cualquier cliente HTTP. Con navegador la pagina carga, pero ni sus
  // datos estructurados ni sus tarjetas eran reconocibles: la esperanza ahora
  // es el JSON que pide por detras.
  createBrowserAdapter({
    id: 'easy',
    label: 'Easy',
    base: 'https://www.easy.cl',
    buildUrls: (q) => [
      `https://www.easy.cl/search?q=${enc(q)}`,
      `https://www.easy.cl/${enc(q)}?map=ft`,
    ],
    settleMs: 2500,
  }),
  // Paris carga los productos por XHR: el HTML inicial trae las tarjetas
  // vacias, con 213 "skeleton". Es el caso exacto que resuelve capturar el
  // XHR en vez de mirar el DOM.
  createBrowserAdapter({
    id: 'paris',
    label: 'Paris',
    base: 'https://www.paris.cl',
    buildUrls: (q) => [`https://www.paris.cl/search/?q=${enc(q)}`],
    cardSelectors: ['[data-testid^="paris-vertical-pod"]', '[data-testid*="pod"]'],
    waitForSelector: '[data-testid="paris-pod-price"]',
    settleMs: 2500,
  }),

  // --- Otras tiendas -------------------------------------------------------
  // La unica con API propia: JSON publico, sin auth ni WAF, sin navegador.
  // Catalogo de informatica, asi que aporta en busquedas de tecnologia y no
  // en las de hogar.
  createPcFactoryAdapter(),

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
    settleMs: 2500,
  }),
  // Protegida con PerimeterX: verificado con `--capture`, las unicas
  // respuestas que pide la pagina son las del recolector de huellas
  // (collector-*.px-cloud.net). Los productos nunca llegan a cargar, ni con
  // navegador. No es un problema de extraccion y no se arregla con codigo:
  // haria falta IP residencial o un servicio de desbloqueo de pago.
  createBrowserAdapter({
    id: 'lider',
    label: 'Lider',
    enabled: false,
    base: 'https://www.lider.cl',
    buildUrls: (q) => [`https://www.lider.cl/search?query=${enc(q)}`],
    settleMs: 2500,
  }),
  // Responden 200 pero ninguna de las seis tecnicas les reconocio un producto,
  // y ademas son de construccion: no venden nada de lo que se monitorea.
  createUnknownPlatformStore({
    id: 'construmart',
    label: 'Construmart',
    host: 'www.construmart.cl',
    enabled: false,
  }),
  createUnknownPlatformStore({
    id: 'imperial',
    label: 'Imperial',
    host: 'www.imperial.cl',
    enabled: false,
  }),

  // --- Candidatas sin verificar --------------------------------------------
  // Declaradas por su host y nada mas: la cadena de `createUnknownPlatformStore`
  // sondea las seis tecnicas y el log de la primera corrida dice cual sirvio.
  // Si alguna queda en rojo, apagarla es poner `enabled: false` en su bloque.
  createUnknownPlatformStore({ id: 'hites', label: 'Hites', host: 'www.hites.com' }),
  // La Polar y ABCDIN son el mismo sitio tras la fusion: responden 200 pero
  // ninguna tecnica les saca un producto (SPA con todo tras el muro).
  createUnknownPlatformStore({
    id: 'lapolar',
    label: 'La Polar',
    host: 'www.lapolar.cl',
    enabled: false,
  }),
  createUnknownPlatformStore({
    id: 'abcdin',
    label: 'ABCDIN',
    host: 'www.abcdin.cl',
    enabled: false,
  }),
  // No resuelve ni conecta desde ninguna de las dos IP probadas.
  createUnknownPlatformStore({
    id: 'corona',
    label: 'Corona',
    host: 'www.corona.cl',
    enabled: false,
  }),
  // Informatica, para acompanar a PC Factory. Ambas devuelven un muro
  // anti-bot con 403, igual desde GitHub Actions que desde un VPS: el bloqueo
  // no es por reputacion de IP.
  createUnknownPlatformStore({
    id: 'spdigital',
    label: 'SP Digital',
    host: 'www.spdigital.cl',
    enabled: false,
  }),
  createUnknownPlatformStore({
    id: 'winpy',
    label: 'Winpy',
    host: 'www.winpy.cl',
    enabled: false,
  }),

  // --- Supermercados y farmacias -------------------------------------------
  // Aca viven los productos que se estan monitoreando: panales, desodorante,
  // suplementos, aseo. Casi todos corren sobre VTEX, cuyo catalogo publico es
  // la primera tecnica que prueba `createUnknownPlatformStore`.
  // Las rutas van declaradas porque ya se verifico cual responde 200 en cada
  // una: sin esto la cadena gasta media docena de 404 antes de acertar.
  createUnknownPlatformStore({
    id: 'jumbo',
    label: 'Jumbo',
    host: 'www.jumbo.cl',
    paths: (q) => [`https://www.jumbo.cl/busqueda?q=${enc(q)}`],
  }),
  createUnknownPlatformStore({
    id: 'santaisabel',
    label: 'Santa Isabel',
    host: 'www.santaisabel.cl',
    paths: (q) => [
      `https://www.santaisabel.cl/busqueda?q=${enc(q)}`,
      `https://www.santaisabel.cl/buscar?q=${enc(q)}`,
    ],
  }),
  // Adaptador propio: usa el mismo BFF que su buscador web, encontrado
  // capturando el XHR del navegador. Una peticion y sin HTML de por medio.
  createUnimarcAdapter(),
  createUnknownPlatformStore({ id: 'salcobrand', label: 'Salcobrand', host: 'salcobrand.cl' }),
  // Corre sobre Salesforce Commerce Cloud (el `.isml` del HTML lo delata).
  createUnknownPlatformStore({
    id: 'ahumada',
    label: 'Farmacias Ahumada',
    host: 'www.farmaciasahumada.cl',
    paths: (q) => [`https://www.farmaciasahumada.cl/search?q=${enc(q)}`],
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
