import type {
  AdapterContext,
  NormalizedOffer,
  RunSummary,
  SearchDefinition,
  StoreAdapter,
  StoreRunStat,
} from '../types.js';
import { mapWithConcurrency } from '../lib/pool.js';
import { mergeOffers, normalizeOffers } from './normalize.js';

/**
 * Tiendas consultadas a la vez por defecto.
 *
 * Cada tienda es un host distinto, asi que el paralelismo no aprieta a
 * ninguna: la cortesia sigue siendo de una peticion a la vez por tienda. El
 * tope lo pone la memoria, porque varias de ellas abren un contexto de
 * Chromium. Cuatro es holgado para un runner de GitHub Actions.
 */
export const DEFAULT_CONCURRENCY = 4;

export interface RunOptions {
  stores: StoreAdapter[];
  searches: SearchDefinition[];
  /** Maximo de resultados por consulta y por tienda. */
  limit: number;
  dryRun: boolean;
  /** Tiendas consultadas simultaneamente. 1 vuelve a la corrida secuencial. */
  concurrency?: number;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface RunResult {
  offers: NormalizedOffer[];
  stores: StoreRunStat[];
  errors: string[];
  runId: string;
  startedAt: Date;
  /**
   * Busquedas cuyas consultas respondieron todas, en todas las tiendas.
   *
   * Solo para ellas se puede afirmar que un producto que no aparecio "ya no
   * corresponde": si una consulta fallo, la ausencia puede ser del error.
   */
  completedSearchIds: string[];
}

/** Lo que deja una tienda tras recorrer todas las busquedas. */
interface StoreOutcome {
  stat: StoreRunStat;
  offers: NormalizedOffer[];
  errors: string[];
  /** Busquedas en las que esta tienda fallo al menos una consulta. */
  failedSearchIds: string[];
}

/**
 * Recorre tiendas x busquedas x consultas y devuelve las ofertas relevantes.
 *
 * Las tiendas van en paralelo y las consultas de cada una en fila: son hosts
 * independientes, de modo que esperar a Falabella para preguntarle a Sodimac
 * solo alargaba la corrida. Dentro de una tienda el orden se mantiene porque
 * ahi si comparten servidor —y estado, en los adaptadores que recuerdan que
 * estrategia les funciono.
 *
 * Cada consulta se aisla: si una tienda cambia su HTML o bloquea el trafico,
 * se registra el error y la corrida continua con las demas. Esto importa
 * porque el scraping de retail se rompe seguido y no queremos perder los
 * datos de las tiendas que si respondieron.
 */
export async function runScrape(options: RunOptions): Promise<RunResult> {
  const startedAt = new Date();
  const runId = buildRunId(startedAt);

  const outcomes = await mapWithConcurrency(
    options.stores,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    (store) => runStore(store, options),
  );

  const failedSearches = new Set(outcomes.flatMap((outcome) => outcome.failedSearchIds));

  return {
    offers: mergeOffers(outcomes.flatMap((outcome) => outcome.offers)),
    stores: outcomes.map((outcome) => outcome.stat),
    errors: outcomes.flatMap((outcome) => outcome.errors),
    runId,
    startedAt,
    completedSearchIds: options.searches
      .map((search) => search.id)
      .filter((id) => !failedSearches.has(id)),
  };
}

/** Consulta una tienda con todas las busquedas, una consulta a la vez. */
async function runStore(store: StoreAdapter, options: RunOptions): Promise<StoreOutcome> {
  const storeStart = Date.now();
  const offers: NormalizedOffer[] = [];
  const errors: string[] = [];
  const failedSearchIds = new Set<string>();

  let found = 0;
  let kept = 0;
  let queriesOk = 0;
  let queriesTotal = 0;
  let firstError: string | null = null;

  const ctx: AdapterContext = {
    limit: options.limit,
    log: (msg, extra) => options.log(`[${store.id}] ${msg}`, extra),
  };

  for (const search of options.searches) {
    for (const query of search.queries) {
      queriesTotal += 1;
      try {
        const raw = await store.search(query, ctx);
        found += raw.length;

        const normalized = normalizeOffers(store, search, raw);
        kept += normalized.length;
        offers.push(...normalized);
        queriesOk += 1;

        options.log(
          `[${store.id}] "${query}" -> ${raw.length} resultados, ${normalized.length} relevantes`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        firstError ??= message;
        failedSearchIds.add(search.id);
        errors.push(`${store.id} / "${query}": ${message}`);
        options.log(`[${store.id}] fallo la consulta "${query}": ${message}`);
      }
    }
  }

  if (queriesOk === 0 && queriesTotal > 0) {
    options.log(`[${store.id}] ninguna consulta respondio`);
  }

  return {
    stat: {
      storeId: store.id,
      storeLabel: store.label,
      // Una tienda cuenta como OK si al menos una consulta respondio.
      ok: queriesOk > 0,
      found,
      kept,
      error: queriesOk > 0 ? null : (firstError ?? 'Sin consultas ejecutadas'),
      durationMs: Date.now() - storeStart,
    },
    offers,
    errors,
    failedSearchIds: [...failedSearchIds],
  };
}

/** Id legible y ordenable: 2026-07-26T18-30-00-000Z */
export function buildRunId(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/** Arma el documento de resumen a partir del resultado de la corrida. */
export function buildSummary(
  result: RunResult,
  totals: {
    found: number;
    kept: number;
    created: number;
    updated: number;
    priceChanges: number;
    drops: number;
    rises: number;
  },
  dryRun: boolean,
  finishedAt: Date,
): RunSummary {
  const anyOk = result.stores.some((store) => store.ok);
  const allOk = result.stores.every((store) => store.ok);

  return {
    runId: result.runId,
    startedAt: result.startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - result.startedAt.getTime(),
    status: allOk ? 'ok' : anyOk ? 'partial' : 'error',
    dryRun,
    totals,
    stores: result.stores,
    // Guardamos un maximo razonable para no inflar el documento.
    errors: result.errors.slice(0, 50),
  };
}
