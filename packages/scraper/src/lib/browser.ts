import { chromium, type Browser, type BrowserContext } from 'playwright';

/**
 * Navegador headless compartido para las tiendas que un cliente HTTP no puede
 * leer.
 *
 * Varias tiendas chilenas responden 403 a `fetch` aunque lleve cabeceras de
 * navegador, porque sus defensas identifican la huella TLS y exigen ejecutar
 * JavaScript. Otras devuelven 200 pero cargan los productos por XHR, asi que
 * el HTML inicial viene vacio. Un Chromium real resuelve ambos casos.
 *
 * El navegador se lanza una sola vez por corrida y se reutiliza: arrancarlo
 * cuesta uno o dos segundos y hacerlo por consulta multiplicaria el tiempo
 * total sin ganar nada.
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** Recursos que no aportan al scraping y si pesan en tiempo y ancho de banda. */
const BLOCKED_RESOURCES = new Set(['image', 'media', 'font']);

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

export interface RenderOptions {
  /** Espera a que aparezca este selector antes de leer el HTML. */
  waitForSelector?: string;
  /** Milisegundos de gracia tras la carga, para el contenido que llega por XHR. */
  settleMs?: number;
  timeoutMs?: number;
}

async function getBrowser(): Promise<Browser> {
  if (browser) return browser;

  // Permite usar un Chromium ya instalado en el sistema. Sirve en imagenes de
  // CI que lo traen incluido y evita que un desajuste de version entre
  // Playwright y el navegador descargado impida arrancar.
  const executablePath = process.env['CHROMIUM_PATH'];

  // Se cachea la promesa, no solo el resultado: dos consultas concurrentes no
  // deben lanzar dos navegadores.
  launching ??= chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    ...(executablePath ? { executablePath } : {}),
  });

  browser = await launching;
  return browser;
}

/** Cierra el navegador al terminar la corrida. Seguro de llamar siempre. */
export async function closeBrowser(): Promise<void> {
  const current = browser;
  browser = null;
  launching = null;
  await current?.close();
}

/** Devuelve el HTML de una pagina ya renderizada, con su JavaScript ejecutado. */
export async function renderHtml(url: string, options: RenderOptions = {}): Promise<string> {
  const instance = await getBrowser();
  const context: BrowserContext = await instance.newContext({
    userAgent: USER_AGENT,
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'es-CL,es;q=0.9' },
  });

  try {
    const page = await context.newPage();

    await page.route('**/*', (route) => {
      if (BLOCKED_RESOURCES.has(route.request().resourceType())) return route.abort();
      return route.continue();
    });

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs ?? 30_000,
    });

    if (options.waitForSelector) {
      // Que no aparezca no es fatal: puede que la busqueda no tenga
      // resultados, y eso lo decide el extractor con el HTML en la mano.
      await page
        .waitForSelector(options.waitForSelector, { timeout: 15_000 })
        .catch(() => undefined);
    }

    if (options.settleMs && options.settleMs > 0) {
      await page.waitForTimeout(options.settleMs);
    }

    return await page.content();
  } finally {
    await context.close();
  }
}
