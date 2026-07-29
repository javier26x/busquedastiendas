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

function parseArgs(argv: string[]): { query: string; store: string | null; dump: string | null } {
  let query = 'caja organizadora';
  let store: string | null = null;
  let dump: string | null = null;

  for (const arg of argv) {
    if (arg.startsWith('--query=')) query = arg.slice('--query='.length);
    else if (arg.startsWith('--store=')) store = arg.slice('--store='.length);
    // Vuelca el HTML de un selector concreto, para afinar un adaptador.
    else if (arg.startsWith('--dump=')) dump = arg.slice('--dump='.length);
  }

  return { query, store, dump };
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
      console.log(`    HTML de la primera coincidencia de ${target}:`);
      const html = $.html(first).replace(/>\s+</g, '>\n<');
      console.log(indent(html, 6, 2200));
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
  const { query, store, dump } = parseArgs(process.argv.slice(2));
  dumpSelector = dump;
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
