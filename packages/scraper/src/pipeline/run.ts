import type {
  AdapterContext,
  NormalizedOffer,
  RunSummary,
  SearchDefinition,
  StoreAdapter,
  StoreRunStat,
} from '../types.js';
import { mergeOffers, normalizeOffers } from './normalize.js';

export interface RunOptions {
  stores: StoreAdapter[];
  searches: SearchDefinition[];
  /** Maximo de resultados por consulta y por tienda. */
  limit: number;
  dryRun: boolean;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface RunResult {
  offers: NormalizedOffer[];
  stores: StoreRunStat[];
  errors: string[];
  runId: string;
  startedAt: Date;
}

/**
 * Recorre tiendas x busquedas x consultas y devuelve las ofertas relevantes.
 *
 * Cada consulta se aisla: si una tienda cambia su HTML o bloquea el trafico,
 * se registra el error y la corrida continua con las demas. Esto importa
 * porque el scraping de retail se rompe seguido y no queremos perder los
 * datos de las tiendas que si respondieron.
 */
export async function runScrape(options: RunOptions): Promise<RunResult> {
  const startedAt = new Date();
  const runId = buildRunId(startedAt);
  const errors: string[] = [];
  const storeStats: StoreRunStat[] = [];
  const collected: NormalizedOffer[] = [];

  for (const store of options.stores) {
    const storeStart = Date.now();
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
          collected.push(...normalized);
          queriesOk += 1;

          options.log(
            `[${store.id}] "${query}" -> ${raw.length} resultados, ${normalized.length} relevantes`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          firstError ??= message;
          errors.push(`${store.id} / "${query}": ${message}`);
          options.log(`[${store.id}] fallo la consulta "${query}": ${message}`);
        }
      }
    }

    storeStats.push({
      storeId: store.id,
      storeLabel: store.label,
      // Una tienda cuenta como OK si al menos una consulta respondio.
      ok: queriesOk > 0,
      found,
      kept,
      error: queriesOk > 0 ? null : (firstError ?? 'Sin consultas ejecutadas'),
      durationMs: Date.now() - storeStart,
    });

    if (queriesOk === 0 && queriesTotal > 0) {
      options.log(`[${store.id}] ninguna consulta respondio`);
    }
  }

  return { offers: mergeOffers(collected), stores: storeStats, errors, runId, startedAt };
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
