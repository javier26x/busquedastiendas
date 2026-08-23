/**
 * Diagnostico de tiendas.
 *
 * Prueba varias URL candidatas por tienda y describe que devuelve cada una:
 * codigo HTTP, tipo de contenido, si trae datos estructurados y donde estan
 * los arreglos que parecen productos. Sirve para escribir o reparar un
 * adaptador sin ir adivinando.
 *
 *   npm run diagnose
 *   npm run diagnose -- --query="caja organizadora"
 *   npm run diagnose -- --store=easy
 *   npm run diagnose -- --probe=www.tienda.cl   (que tecnica sirve para esa tienda)
 *   npm run diagnose -- --capture='https://www.lider.cl/search?query=panales'
 *                                               (vuelca el JSON que pide por XHR)
 *   npm run diagnose -- --blocked   (compara los bloqueos contra los de CI)
 */
import * as cheerio from 'cheerio';
import type { AdapterContext, StoreAdapter } from './types.js';
import { createVtexAdapter, createVtexIntelligentSearchAdapter } from './adapters/vtex.js';
import { createShopifyAdapter, createWooCommerceAdapter } from './adapters/platform.js';

interface Probe {
  store: string;
  label: string;
  /** Construye la URL a partir del termino de busqueda. */
  url: (query: string) => string;
}

/**
 * Solo se sondean las URL que ya se sabe que responden 200.
 *
 * Las que devuelven 403 en todas sus rutas (Easy, Ripley) estan bloqueadas
 * por un WAF y no es un problema de ruta; las que dan 404 en todas apuntan a
 * un dominio equivocado. En ambos casos el sondeo no aporta nada nuevo.
 */
const PROBES: Probe[] = [
  {
    store: 'falabella',
    label: 'referencia que SI funciona',
    url: (q) => `https://www.falabella.com/falabella-cl/search?Ntt=${encodeURIComponent(q)}`,
  },
  {
    store: 'ikea',
    label: 'plataforma Falabella (ikea.cl lo opera Falabella)',
    url: (q) => `https://www.ikea.cl/ikea-cl/search?Ntt=${encodeURIComponent(q)}`,
  },
  {
    store: 'ikea',
    label: 'busqueda propia',
    url: (q) => `https://www.ikea.cl/search?q=${encodeURIComponent(q)}`,
  },
  {
    store: 'ikea',
    label: 'sitio global de IKEA',
    url: (q) => `https://www.ikea.com/cl/es/search/?q=${encodeURIComponent(q)}`,
  },
  {
    store: 'ripley',
    label: 'dominio principal',
    url: (q) => `https://www.ripley.cl/search/${encodeURIComponent(q)}`,
  },
  {
    store: 'ripley',
    label: 'simple.ripley.cl (daba 403)',
    url: (q) => `https://simple.ripley.cl/search/${encodeURIComponent(q)}`,
  },
  {
    store: 'paris',
    label: 'responde 200 sin datos reconocidos',
    url: (q) => `https://www.paris.cl/search/?q=${encodeURIComponent(q)}`,
  },
  {
    store: 'sodimac',
    label: 'responde 200 sin datos reconocidos',
    url: (q) => `https://www.sodimac.cl/sodimac-cl/search?Ntt=${encodeURIComponent(q)}`,
  },
  {
    store: 'lider',
    label: 'responde 200 sin datos reconocidos',
    url: (q) => `https://www.lider.cl/search?query=${encodeURIComponent(q)}`,
  },
  {
    store: 'imperial',
    label: 'responde 200 sin datos reconocidos',
    url: (q) => `https://www.imperial.cl/search?q=${encodeURIComponent(q)}`,
  },
  {
    store: 'mercadolibre',
    label: 'listado',
    url: (q) => `https://listado.mercadolibre.cl/${encodeURIComponent(q.replace(/\s+/g, '-'))}`,
  },
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

interface Args {
  query: string;
  store: string | null;
  dump: string | null;
  /** Host a sondear con todas las tecnicas conocidas. */
  probe: string | null;
  /** URL a renderizar en el navegador para volcar el JSON que pide por XHR. */
  capture: string | null;
  /** Repite desde aqui los bloqueos que se vieron en GitHub Actions. */
  blocked: boolean;
}

/**
 * Lo que devolvio cada tienda bloqueada en la corrida de GitHub Actions.
 *
 * Sirve de linea base: si desde otra maquina cambia el resultado, el problema
 * era la reputacion de la IP del runner y mover el scraper resuelve; si da
 * igual, el bloqueo no es por IP y hay que atacarlo de otra forma.
 */
const BLOCKED: { id: string; label: string; enActions: string; url: string }[] = [
  { id: 'spdigital', label: 'SP Digital', enActions: 'HTTP 403', url: 'https://www.spdigital.cl/search?q=notebook' },
  { id: 'winpy', label: 'Winpy', enActions: 'HTTP 403', url: 'https://www.winpy.cl/search?q=notebook' },
  { id: 'corona', label: 'Corona', enActions: 'fetch failed', url: 'https://www.corona.cl/search?q=toalla' },
  { id: 'lapolar', label: 'La Polar', enActions: 'HTML en vez de JSON', url: 'https://www.lapolar.cl/search?q=panales' },
  { id: 'abcdin', label: 'ABCDIN', enActions: 'HTML en vez de JSON', url: 'https://www.abcdin.cl/search?q=notebook' },
  { id: 'imperial', label: 'Imperial', enActions: 'HTTP 404 / sin datos', url: 'https://www.imperial.cl/search?q=madera' },
  { id: 'construmart', label: 'Construmart', enActions: 'HTTP 404', url: 'https://www.construmart.cl/catalogsearch/result/?q=cemento' },
  // Estas cargaron bien (200) y el navegador las renderizo: su problema NO es
  // de IP. Se incluyen para dejarlo demostrado en la misma tabla.
  { id: 'lider', label: 'Lider', enActions: '200, sin productos reconocidos', url: 'https://www.lider.cl/search?query=panales' },
  { id: 'paris', label: 'Paris', enActions: '200, sin productos reconocidos', url: 'https://www.paris.cl/search/?q=panales' },
  { id: 'ripley', label: 'Ripley', enActions: '200, sin productos reconocidos', url: 'https://simple.ripley.cl/search/panales' },
  { id: 'easy', label: 'Easy', enActions: '200, sin productos reconocidos', url: 'https://www.easy.cl/search?q=parrilla' },
];

/** Señales de que lo que volvio es un muro anti-bot y no la tienda. */
const BLOCK_PAGE = /captcha|are you a robot|access denied|forbidden|incapsula|cloudflare|attention required/i;

/**
 * Repite los bloqueos desde esta maquina y los compara con los de CI.
 *
 * Es la prueba que decide si conviene mover el scraper a otro servidor: usa el
 * mismo cliente y las mismas cabeceras que la corrida real, asi lo unico que
 * cambia es desde donde sale la peticion.
 */
async function probeBlocked(): Promise<void> {
  const { fetchHtml, HttpError } = await import('./lib/http.js');

  console.log('\n=== Bloqueos vistos desde esta maquina ===\n');
  console.log('Mismo cliente y mismas cabeceras que la corrida real: lo unico');
  console.log('que cambia es la IP de origen.\n');

  const mejoraron: string[] = [];
  // Las que en CI respondieron 200: son el testigo. Si aqui tampoco responden,
  // el problema es la red de esta maquina y no las tiendas.
  const testigos: string[] = [];

  for (const entry of BLOCKED) {
    let aqui: string;
    let respondio = false;
    let cambio = false;

    try {
      const html = await fetchHtml(entry.url, { retries: 0, timeoutMs: 20_000 });
      const bloqueo = BLOCK_PAGE.test(html.slice(0, 4000));
      respondio = !bloqueo;
      aqui = bloqueo
        ? `200 pero es un muro anti-bot (${html.length} bytes)`
        : `200 OK (${html.length} bytes)`;
      // Solo cuenta como mejora si antes ni siquiera respondia.
      cambio = respondio && !entry.enActions.startsWith('200');
    } catch (error) {
      aqui =
        error instanceof HttpError
          ? `HTTP ${error.status}`
          : (error instanceof Error ? error.message : String(error)).slice(0, 60);
    }

    if (cambio) mejoraron.push(entry.id);
    if (entry.enActions.startsWith('200') && !respondio) testigos.push(entry.label);

    console.log(`${cambio ? '🟢' : '  '} ${entry.label.padEnd(13)} en Actions: ${entry.enActions.padEnd(32)} aqui: ${aqui}`);
  }

  console.log('');

  // Antes de concluir nada: si las que si respondian en CI tampoco responden
  // aqui, esta maquina no tiene salida directa a internet y la comparacion no
  // vale. Sin esta comprobacion el diagnostico afirmaria lo contrario de lo
  // que pasa, que es peor que no diagnosticar.
  if (testigos.length > 0) {
    console.log(`⚠ No se puede concluir: ${testigos.join(', ')} tambien fallan aqui,`);
    console.log('  y en CI respondian 200. Esta maquina esta detras de un proxy o');
    console.log('  cortafuegos que bloquea las tiendas. Corre esto donde tengas');
    console.log('  salida directa a internet (tu VPS).');
    return;
  }

  if (mejoraron.length > 0) {
    console.log(`Estas SI responden desde aqui y no desde CI: ${mejoraron.join(', ')}`);
    console.log('El bloqueo era por la IP del runner. Correr el scraper en este');
    console.log('servidor las recupera; ver "Correr el scraper en un VPS" en el README.');
  } else {
    console.log('Ninguna cambio de resultado: el bloqueo no depende de la IP,');
    console.log('asi que mover el scraper a otro servidor no las recuperaria.');
  }
}

function parseArgs(argv: string[]): Args {
  let query = 'caja organizadora';
  let store: string | null = null;
  let dump: string | null = null;
  let probe: string | null = null;
  let capture: string | null = null;
  let blocked = false;

  for (const arg of argv) {
    if (arg.startsWith('--query=')) query = arg.slice('--query='.length);
    else if (arg.startsWith('--store=')) store = arg.slice('--store='.length);
    // Vuelca el HTML de un selector concreto, para afinar un adaptador.
    else if (arg.startsWith('--dump=')) dump = arg.slice('--dump='.length);
    else if (arg.startsWith('--probe=')) probe = arg.slice('--probe='.length);
    else if (arg.startsWith('--capture=')) capture = arg.slice('--capture='.length);
    else if (arg === '--blocked') blocked = true;
  }

  return { query, store, dump, probe, capture, blocked };
}

/**
 * Renderiza una URL en el navegador y vuelca el JSON que la pagina pidio.
 *
 * Es para las tiendas que cargan sus productos por XHR (Lider, Ripley): el
 * adaptador captura esas respuestas pero, si no reconoce el producto dentro,
 * hace falta ver su forma para ensenarle el nombre de los campos.
 */
async function captureXhr(url: string): Promise<void> {
  const { renderPage } = await import('./lib/browser.js');
  const { extractJsonOffers, topLevelKeys } = await import('./lib/json-catalog.js');
  const { closeBrowser } = await import('./lib/browser.js');

  const base = new URL(url).origin;
  console.log(`\n=== Capturando XHR de ${url} ===\n`);

  try {
    const { json } = await renderPage(url, { captureJson: true, settleMs: 3000 });
    console.log(`Se capturaron ${json.length} respuestas JSON.\n`);

    // Antes de mirar el contenido: si toda la actividad es de un anti-bot, no
    // hay nada que parsear y decir "0 productos" mandaria a buscar un error de
    // extraccion donde en realidad hay un bloqueo.
    const guardias = [...new Set(json.flatMap((entry) => antibot(entry.url)))];
    if (guardias.length > 0) {
      console.log(`⚠ Esta tienda usa ${guardias.join(' y ')}.`);
      console.log('  Lo capturado son sus llamadas de deteccion, no productos.\n');
    }

    // Se ordena por tamano: el listado de resultados suele ser el mas grande.
    const ranked = json
      .map((entry) => ({ ...entry, size: JSON.stringify(entry.body).length }))
      .sort((a, b) => b.size - a.size);

    for (const entry of ranked.slice(0, 8)) {
      const offers = extractJsonOffers(entry.body, { base });
      console.log(`• ${entry.url}`);
      console.log(`  ${entry.size} bytes · claves: ${topLevelKeys(entry.body)}`);
      console.log(`  el extractor generico saca: ${offers.length} producto(s)`);

      // Donde hay arreglos grandes: ahi suelen estar los productos.
      const arrays = describeArrays(entry.body);
      if (arrays.length > 0) {
        console.log('  arreglos:');
        for (const line of arrays) console.log(`    ${line}`);
      }

      const sample = findProductSample(entry.body);
      if (sample && offers.length === 0) {
        console.log(`  posible producto en ${sample.path}:`);
        console.log(indent(JSON.stringify(sample.item, null, 2), 4, 1200));
      }
      console.log('');
    }

    if (json.length === 0) {
      console.log('La pagina no pidio ningun JSON: sus productos no llegan por XHR.');
      return;
    }

    const conProductos = json.filter(
      (entry) => extractJsonOffers(entry.body, { base }).length > 0,
    );

    if (conProductos.length === 0) {
      console.log('Ninguna respuesta traia productos.');
      if (guardias.length > 0) {
        console.log(
          `Los productos nunca llegaron a cargar: ${guardias.join(' y ')} corto la pagina antes.\n` +
            'No es un problema de extraccion, es un bloqueo. Saltarlo no se\n' +
            'resuelve con codigo: haria falta IP residencial o un servicio de\n' +
            'desbloqueo de pago.',
        );
      }
    }
  } finally {
    await closeBrowser();
  }
}

/** Servicios anti-bot reconocibles por el dominio al que llaman. */
const ANTIBOT: { patron: RegExp; nombre: string }[] = [
  { patron: /px-cloud\.net|perimeterx/i, nombre: 'PerimeterX (HUMAN)' },
  { patron: /datadome/i, nombre: 'DataDome' },
  { patron: /akstat|akamaihd|\/_abck|akamai/i, nombre: 'Akamai Bot Manager' },
  { patron: /incapsula|imperva/i, nombre: 'Imperva Incapsula' },
  { patron: /cdn-cgi\/challenge|turnstile/i, nombre: 'Cloudflare' },
  { patron: /recaptcha|hcaptcha/i, nombre: 'CAPTCHA' },
];

function antibot(url: string): string[] {
  return ANTIBOT.filter((entry) => entry.patron.test(url)).map((entry) => entry.nombre);
}

/**
 * Sondea un host con todas las tecnicas conocidas y dice cual funciona.
 *
 * Es el paso previo a agregar una tienda: en vez de suponer sobre que corre,
 * se prueba y el resultado indica que adaptador declarar en `config/stores.ts`.
 */
async function probeTechniques(host: string, query: string): Promise<void> {
  const clean = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  const techniques: { name: string; recipe: string; adapter: StoreAdapter }[] = [
    {
      name: 'VTEX (catalogo clasico)',
      recipe: `createVtexAdapter({ id, label, host: '${clean}' })`,
      adapter: createVtexAdapter({ id: 'probe', label: clean, host: clean }),
    },
    {
      name: 'VTEX Intelligent Search',
      recipe: `createVtexIntelligentSearchAdapter({ id, label, host: '${clean}' })`,
      adapter: createVtexIntelligentSearchAdapter({ id: 'probe', label: clean, host: clean }),
    },
    {
      name: 'Shopify',
      recipe: `createShopifyAdapter({ id, label, host: '${clean}' })`,
      adapter: createShopifyAdapter({ id: 'probe', label: clean, host: clean }),
    },
    {
      name: 'WooCommerce Store API',
      recipe: `createWooCommerceAdapter({ id, label, host: '${clean}' })`,
      adapter: createWooCommerceAdapter({ id: 'probe', label: clean, host: clean }),
    },
  ];

  console.log(`\n=== ${clean} · sondeo de tecnicas con "${query}" ===\n`);

  const ctx: AdapterContext = { limit: 5, log: () => undefined };
  let winner: (typeof techniques)[number] | null = null;

  for (const technique of techniques) {
    try {
      const offers = await technique.adapter.search(query, ctx);
      if (offers.length > 0) {
        console.log(`  ✅ ${technique.name}: ${offers.length} productos`);
        console.log(`     ej: "${offers[0]?.title}" $${offers[0]?.price}`);
        winner ??= technique;
      } else {
        console.log(`  ·  ${technique.name}: responde, sin productos`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ✗  ${technique.name}: ${message.slice(0, 110)}`);
    }
  }

  if (winner) {
    console.log(`\n  Agregala a config/stores.ts con:\n    ${winner.recipe}`);
    return;
  }

  console.log(
    '\n  Ninguna API publica respondio. Quedan las tecnicas sobre HTML:\n' +
      `    createUnknownPlatformStore({ id, label, host: '${clean}' })   (prueba todo lo anterior mas HTML y DOM)\n` +
      `    createBrowserAdapter({ id, label, base: 'https://${clean}', buildUrls })   (navegador; captura tambien el XHR)\n` +
      `  Para ver que devuelve el HTML: npm run diagnose -- --store=<id>`,
  );
}

/** Selector cuyo HTML se quiere ver; lo fija `--dump=`. */
let dumpSelector: string | null = null;

/** Describe donde hay arreglos grandes dentro de un JSON, para ubicar los productos. */
function describeArrays(value: unknown, path = '$', depth = 0, found: string[] = []): string[] {
  if (depth > 6 || found.length >= 8 || value === null || typeof value !== 'object') return found;

  if (Array.isArray(value)) {
    if (value.length >= 3) {
      const first = value.find((entry) => entry && typeof entry === 'object');
      const keys = first ? Object.keys(first as object).slice(0, 8).join(', ') : 'primitivos';
      found.push(`${path}  [${value.length}]  claves: ${keys}`);
    }
    for (const entry of value.slice(0, 2)) describeArrays(entry, `${path}[]`, depth + 1, found);
    return found;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    describeArrays(child, `${path}.${key}`, depth + 1, found);
  }

  return found;
}

const NAME_HINTS = ['displayName', 'productName', 'productTitle', 'name', 'title'];

/** Primer elemento de un arreglo cuyos objetos parecen productos. */
function findProductSample(
  value: unknown,
  path = '$',
  depth = 0,
): { path: string; item: unknown } | null {
  if (depth > 8 || value === null || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    const first = value.find((entry) => entry && typeof entry === 'object');
    if (first && value.length >= 3) {
      const keys = Object.keys(first as object);
      // Un nombre y suficientes campos: un facet o un menu no califican.
      if (keys.some((key) => NAME_HINTS.includes(key)) && keys.length >= 5) {
        return { path, item: first };
      }
    }
    for (const entry of value.slice(0, 2)) {
      const found = findProductSample(entry, `${path}[]`, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const found = findProductSample(child, `${path}.${key}`, depth + 1);
    if (found) return found;
  }

  return null;
}

function indent(text: string, spaces: number, max: number): string {
  const pad = ' '.repeat(spaces);
  const clipped = text.length > max ? `${text.slice(0, max)}\n… (recortado)` : text;
  return clipped
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

/** Corta el objeto JSON balanceado que empieza en `start`. */
function sliceBalancedJson(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function probe(entry: Probe, query: string): Promise<void> {
  const url = entry.url(query);
  console.log(`\n  ${entry.label}`);
  console.log(`  ${url}`);

  let response: Response;
  const started = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9',
      },
    });
    clearTimeout(timer);
  } catch (error) {
    console.log(`    ✗ error de red: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const body = await response.text();
  const type = response.headers.get('content-type') ?? '?';
  const flag = response.ok ? '✓' : '✗';

  console.log(
    `    ${flag} HTTP ${response.status} · ${type.split(';')[0]} · ${body.length} bytes · ${Date.now() - started} ms`,
  );

  if (!response.ok) {
    console.log(`    cuerpo: ${body.replace(/\s+/g, ' ').slice(0, 180)}`);
    return;
  }

  // Respuesta JSON: describir la forma para ubicar los productos.
  const asJson = safeParse(body);
  if (asJson !== undefined) {
    console.log('    JSON detectado. Arreglos encontrados:');
    const arrays = describeArrays(asJson);
    if (arrays.length === 0) console.log('      (ninguno con 3+ elementos)');
    for (const line of arrays) console.log(`      ${line}`);
    return;
  }

  // Respuesta HTML: reportar que datos estructurados hay.
  const $ = cheerio.load(body);
  const ldBlocks = $('script[type="application/ld+json"]');
  let ldWithProduct = 0;
  ldBlocks.each((_i, el) => {
    if ($(el).contents().text().includes('"Product"')) ldWithProduct += 1;
  });

  console.log(`    JSON-LD: ${ldBlocks.length} bloque(s), ${ldWithProduct} con "Product"`);

  // Se revisan TODOS los scripts en linea, no solo los nombres conocidos:
  // cada tienda guarda su estado con un nombre distinto y lo que interesa es
  // encontrar donde estan los productos, se llame como se llame.
  const scripts = $('script:not([src])').toArray();
  let dumped = 0;

  for (const script of scripts) {
    if (dumped >= 3) break;

    const text = $(script).contents().text();
    if (text.length < 2000) continue; // Los estados con productos son grandes.

    const id = $(script).attr('id') ?? $(script).attr('type') ?? '(sin id)';

    // El script puede ser JSON puro o una asignacion `window.X = {...}`.
    let parsed = safeParse(text.trim());
    if (parsed === undefined) {
      const start = text.indexOf('{');
      if (start !== -1) parsed = safeParse(sliceBalancedJson(text, start) ?? '');
    }

    if (parsed === undefined) continue;

    const arrays = describeArrays(parsed);
    if (arrays.length === 0) continue;

    dumped += 1;
    console.log(`    script ${id} (${text.length} bytes) — arreglos:`);
    for (const line of arrays) console.log(`      ${line}`);

    // Un ejemplo completo del arreglo que parece de productos: sin ver los
    // nombres reales de los campos de precio y enlace no se puede escribir
    // el extractor.
    const sample = findProductSample(parsed);
    if (sample) {
      console.log(`    ejemplo de producto en ${sample.path}:`);
      console.log(indent(JSON.stringify(sample.item, null, 1), 6, 2600));
    }
  }

  if (dumped === 0) {
    console.log('    ningun script en linea contiene JSON con arreglos grandes');
    console.log('    (probable carga por XHR: los productos no vienen en el HTML)');
  }

  // Cuando los productos estan en el DOM y no en un JSON, hay que atacarlos
  // por selector. Los `data-testid` mas repetidos suelen ser la tarjeta de
  // producto y sus partes.
  const testIds = new Map<string, number>();
  $('[data-testid]').each((_i, element) => {
    const id = $(element).attr('data-testid') ?? '';
    // Los ids con indice ("pod-1", "pod-2") se agrupan por su raiz.
    const family = id.replace(/[-_]?\d+$/, '');
    if (family) testIds.set(family, (testIds.get(family) ?? 0) + 1);
  });

  const repeated = [...testIds.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  if (repeated.length > 0) {
    console.log('    data-testid repetidos (candidatos a tarjeta de producto):');
    for (const [id, count] of repeated) console.log(`      ${id} × ${count}`);

    // El HTML de una tarjeta real: sin verlo no se puede escribir el selector
    // del titulo, el enlace y el precio, solo suponerlo.
    const target = dumpSelector ?? `[data-testid^="${repeated[0]?.[0] ?? ''}"]`;
    const first = $(target).first();

    if (first.length > 0) {
      // Anatomia de la tarjeta: es lo que decide si se puede extraer o no.
      // Volcar el HTML crudo suele cortarse antes de lo que importa.
      const anchors = first.find('a[href]').toArray();
      const prices = first
        .find('[data-testid*="price" i], [class*="price" i], [class*="precio" i]')
        .toArray();
      const texts = first
        .find('*')
        .toArray()
        .map((node) => $(node).text().replace(/\s+/g, ' ').trim())
        .filter((text) => text.length >= 8 && text.length <= 120);

      console.log(`    anatomia de ${target}:`);
      console.log(`      enlaces a[href]: ${anchors.length}`);
      for (const anchor of anchors.slice(0, 3)) {
        console.log(`        href="${$(anchor).attr('href')}"  texto="${$(anchor).text().trim().slice(0, 60)}"`);
      }
      console.log(`      elementos con precio: ${prices.length}`);
      for (const node of prices.slice(0, 4)) {
        console.log(
          `        [${$(node).attr('data-testid') ?? $(node).attr('class')?.slice(0, 30)}] "${$(node).text().trim().slice(0, 40)}"`,
        );
      }
      console.log(`      encabezados h1-h4: ${first.find('h1, h2, h3, h4').length}`);
      console.log('      textos cortos (candidatos a titulo):');
      for (const text of [...new Set(texts)].slice(-4)) console.log(`        "${text}"`);
    } else {
      console.log(`    ${target} no coincidio con nada`);
    }
  }

  const selectors = [
    'li.ui-search-layout__item',
    'div.poly-card',
    '[data-testid]',
    'article',
    '.product-card',
  ];
  const hits = selectors
    .map((selector) => `${selector}=${$(selector).length}`)
    .filter((line) => !line.endsWith('=0'));
  console.log(`    selectores: ${hits.length > 0 ? hits.join(' · ') : 'ninguno de los probados'}`);

  // Una pagina de bloqueo suele ser corta y mencionar el WAF.
  if (/captcha|are you a robot|access denied|forbidden/i.test(body.slice(0, 4000))) {
    console.log('    ⚠ parece una pagina de bloqueo anti-bot');
  }
}

async function main(): Promise<void> {
  const { query, store, dump, probe: probeHost, capture, blocked } = parseArgs(process.argv.slice(2));
  dumpSelector = dump;

  if (blocked) {
    await probeBlocked();
    return;
  }

  if (capture) {
    await captureXhr(capture);
    return;
  }

  if (probeHost) {
    await probeTechniques(probeHost, query);
    return;
  }

  const selected = store ? PROBES.filter((entry) => entry.store === store) : PROBES;

  if (selected.length === 0) {
    console.error(`Tienda desconocida: ${store}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Diagnostico con la consulta: "${query}"`);

  let current = '';
  for (const entry of selected) {
    if (entry.store !== current) {
      current = entry.store;
      console.log(`\n=== ${current} ===`);
    }
    await probe(entry, query);
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  console.log('\nListo.');
}

main().catch((error: unknown) => {
  console.error('Fallo el diagnostico:', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
