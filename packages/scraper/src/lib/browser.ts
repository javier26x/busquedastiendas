import { chromium, type Browser, type BrowserContext, type Response } from 'playwright';

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
  /** Ademas del HTML, guarda las respuestas JSON que pidio la pagina. */
  captureJson?: boolean;
}

/** Una respuesta JSON que la pagina pidio mientras cargaba. */
export interface CapturedJson {
  url: string;
  body: unknown;
}

export interface RenderResult {
  html: string;
  /** Vacio salvo que se pida `captureJson`. */
  json: CapturedJson[];
}

/**
 * Tope de respuestas guardadas por pagina.
 *
 * Una tienda pide decenas de JSON (analitica, banners, recomendados). Con
 * este tope el de los productos entra igual y no se acumula basura.
 */
const MAX_CAPTURED = 60;

/** Respuestas mas grandes que esto casi nunca son el listado de resultados. */
const MAX_CAPTURED_BYTES = 4_000_000;

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
  const { html } = await renderPage(url, options);
  return html;
}

/**
 * Renderiza una pagina y, si se pide, guarda las respuestas JSON que pidio.
 *
 * Capturar el XHR es lo que resuelve las tiendas cuyo HTML no dice nada:
 * cargan los productos por detras desde su propia API, y esa respuesta es un
 * JSON limpio, mucho mejor que raspar las tarjetas del DOM. Ademas revela la
 * direccion de esa API, que despues puede consultarse sin navegador.
 */
export async function renderPage(url: string, options: RenderOptions = {}): Promise<RenderResult> {
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

    // Se acumulan las promesas y se resuelven antes de cerrar el contexto:
    // leer el cuerpo despues seria tarde y Playwright lanzaria.
    const pending: Promise<CapturedJson | null>[] = [];

    if (options.captureJson) {
      page.on('response', (response) => {
        if (pending.length >= MAX_CAPTURED) return;
        if (response.status() !== 200) return;
        if (!/json/i.test(response.headers()['content-type'] ?? '')) return;
        if (response.url() === url) return;

        pending.push(readJson(response));
      });
    }

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

    const html = await page.content();
    const settled = await Promise.all(pending);

    return { html, json: settled.filter((entry): entry is CapturedJson => entry !== null) };
  } finally {
    await context.close();
  }
}

/** Lee el cuerpo de una respuesta sin dejar que un fallo tumbe la corrida. */
async function readJson(response: Response): Promise<CapturedJson | null> {
  try {
    const length = Number(response.headers()['content-length'] ?? '0');
    if (length > MAX_CAPTURED_BYTES) return null;

    const body: unknown = await response.json();
    return { url: response.url(), body };
  } catch {
    // Respuesta abortada, redirigida o con cuerpo ya descartado: no es un
    // error de la corrida, simplemente no hay nada que capturar.
    return null;
  }
}
