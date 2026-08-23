/**
 * Cliente HTTP con reintentos, timeout y cortesia entre peticiones.
 *
 * Las tiendas cortan las peticiones que llegan sin cabeceras de navegador o
 * demasiado rapido, asi que centralizamos ese comportamiento aca en vez de
 * repetirlo en cada adaptador.
 */

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export interface FetchOptions {
  /** Milisegundos antes de abortar la peticion. */
  timeoutMs?: number;
  /** Reintentos ante error de red o 5xx/429. */
  retries?: number;
  headers?: Record<string, string>;
  /** Espera minima antes de disparar la peticion (cortesia con la tienda). */
  politeDelayMs?: number;
  /** Por defecto GET. Algunos buscadores solo responden a POST. */
  method?: string;
  /** Cuerpo de la peticion, ya serializado. */
  body?: string;
}

const DEFAULTS = {
  timeoutMs: 20_000,
  retries: 2,
  politeDelayMs: 700,
} as const;

/** Error con el status HTTP para que el runner pueda reportarlo. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cabeceras que describen de donde sale la peticion.
 *
 * Un GET de pagina y una llamada de API no se ven igual desde el navegador, y
 * mandar las de navegacion en un POST a un API es una incoherencia que algunos
 * back-ends rechazan (Unimarc devolvia 422).
 */
function browserContextHeaders(options: FetchOptions): Record<string, string> {
  const esApi = (options.method ?? 'GET').toUpperCase() !== 'GET' || options.body !== undefined;

  if (esApi) {
    return {
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
    };
  }

  return {
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}

/** Motivo del error segun el cuerpo, recortado y en una linea. */
async function describeBody(response: Response): Promise<string> {
  try {
    const text = (await response.text()).replace(/\s+/g, ' ').trim();
    return text ? `: ${text.slice(0, 200)}` : '';
  } catch {
    // Si el cuerpo no se puede leer, el codigo solo ya es informacion.
    return '';
  }
}

async function request(url: string, options: FetchOptions, accept: string): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const retries = options.retries ?? DEFAULTS.retries;
  const politeDelayMs = options.politeDelayMs ?? DEFAULTS.politeDelayMs;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (politeDelayMs > 0) {
      // Backoff exponencial entre reintentos, cortesia fija en el primer intento.
      await sleep(attempt === 0 ? politeDelayMs : politeDelayMs * 2 ** attempt);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        ...(options.method ? { method: options.method } : {}),
        ...(options.body === undefined ? {} : { body: options.body }),
        headers: {
          'User-Agent': DEFAULT_UA,
          Accept: accept,
          'Accept-Language': 'es-CL,es;q=0.9,es-ES;q=0.8',
          'Cache-Control': 'no-cache',
          // Cabeceras que envia un navegador real. Algunos WAF rechazan
          // peticiones que solo traen User-Agent, por incoherentes.
          ...browserContextHeaders(options),
          'sec-ch-ua': '"Chromium";v="125", "Not.A/Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          ...options.headers,
        },
      });

      // 429 y 5xx son transitorios: vale la pena reintentar.
      if (response.status === 429 || response.status >= 500) {
        lastError = new HttpError(`HTTP ${response.status}`, response.status, url);
        continue;
      }

      if (!response.ok) {
        // Un 4xx suele venir con el motivo en el cuerpo, sobre todo un 422:
        // sin leerlo, "HTTP 422" no dice que campo esta mal y obliga a
        // adivinar. El cuerpo ya no se va a usar para nada mas.
        throw new HttpError(
          `HTTP ${response.status}${await describeBody(response)}`,
          response.status,
          url,
        );
      }

      return response;
    } catch (error) {
      // Un 4xx distinto de 429 no se reintenta: no va a mejorar.
      if (error instanceof HttpError && error.status < 500 && error.status !== 429) {
        throw error;
      }
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`No se pudo obtener ${url}: ${String(lastError)}`);
}

/** Descarga HTML como texto. */
export async function fetchHtml(url: string, options: FetchOptions = {}): Promise<string> {
  const response = await request(url, options, 'text/html,application/xhtml+xml');
  return response.text();
}

/** Descarga y parsea JSON. */
export async function fetchJson<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await request(url, options, 'application/json');
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(
      `Respuesta no-JSON desde ${url} (primeros 120 chars): ${body.slice(0, 120)}`,
    );
  }
}
