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
 */
import * as cheerio from 'cheerio';

interface Probe {
  store: string;
  label: string;
  /** Construye la URL a partir del termino de busqueda. */
  url: (query: string) => string;
}

const PROBES: Probe[] = [
  {
    store: 'mercadolibre',
    label: 'listado (actual)',
    url: (q) => `https://listado.mercadolibre.cl/${encodeURIComponent(q.replace(/\s+/g, '-'))}`,
  },
  {
    store: 'mercadolibre',
    label: 'buscador jm',
    url: (q) => `https://www.mercadolibre.cl/jm/search?as_word=${encodeURIComponent(q)}`,
  },
  {
    store: 'easy',
    label: 'catalogo VTEX (actual)',
    url: (q) =>
      `https://www.easy.cl/api/catalog_system/pub/products/search?ft=${encodeURIComponent(q)}&_from=0&_to=4`,
  },
  {
    store: 'easy',
    label: 'busqueda HTML',
    url: (q) => `https://www.easy.cl/search?q=${encodeURIComponent(q)}`,
  },
  {
    store: 'paris',
    label: 'catalogo VTEX (actual)',
    url: (q) =>
      `https://www.paris.cl/api/catalog_system/pub/products/search?ft=${encodeURIComponent(q)}&_from=0&_to=4`,
  },
  {
    store: 'paris',
    label: 'busqueda HTML',
    url: (q) => `https://www.paris.cl/search/?q=${encodeURIComponent(q)}`,
  },
  {
    store: 'sodimac',
    label: 'busqueda HTML (actual)',
    url: (q) => `https://www.sodimac.cl/sodimac-cl/search?Ntt=${encodeURIComponent(q)}`,
  },
  {
    store: 'sodimac',
    label: 'API interna search-v2',
    url: (q) =>
      `https://www.sodimac.cl/s/search/v1/search?Ntt=${encodeURIComponent(q)}&subdomain=sodimac-cl`,
  },
  {
    store: 'falabella',
    label: 'busqueda HTML (funciona, referencia)',
    url: (q) => `https://www.falabella.com/falabella-cl/search?Ntt=${encodeURIComponent(q)}`,
  },
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function parseArgs(argv: string[]): { query: string; store: string | null } {
  let query = 'caja organizadora';
  let store: string | null = null;

  for (const arg of argv) {
    if (arg.startsWith('--query=')) query = arg.slice('--query='.length);
    else if (arg.startsWith('--store=')) store = arg.slice('--store='.length);
  }

  return { query, store };
}

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

  for (const globalName of ['__NEXT_DATA__', '__PRELOADED_STATE__', '__INITIAL_STATE__']) {
    if (body.includes(globalName)) {
      console.log(`    contiene ${globalName}`);
      if (globalName === '__NEXT_DATA__') {
        const parsed = safeParse($('script#__NEXT_DATA__').first().contents().text());
        if (parsed !== undefined) {
          console.log('      arreglos dentro de __NEXT_DATA__:');
          for (const line of describeArrays(parsed)) console.log(`        ${line}`);
        }
      }
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
  const { query, store } = parseArgs(process.argv.slice(2));
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
