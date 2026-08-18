/**
 * Punto de entrada del scraper.
 *
 *   npm run scrape                      corrida normal (escribe en Firestore)
 *   npm run scrape -- --dry-run         solo muestra por pantalla
 *   npm run scrape -- --stores=easy     limita las tiendas
 *   npm run scrape -- --limit=20        resultados por consulta
 */
import { SEARCHES } from './config/searches.js';
import { resolveStores } from './config/stores.js';
import { runScrape, buildSummary } from './pipeline/run.js';
import {
  deleteOrphanProducts,
  markSearchesRun,
  persistOffers,
  saveRunSummary,
} from './pipeline/persist.js';
import { getDb } from './firestore/client.js';
import { bootstrapSearches, loadSearches } from './firestore/searches.js';
import { closeBrowser } from './lib/browser.js';
import type { NormalizedOffer, SearchDefinition } from './types.js';

interface CliOptions {
  dryRun: boolean;
  stores: string[] | null;
  searches: string[] | null;
  limit: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false, stores: null, searches: null, limit: 30 };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--stores=')) {
      options.stores = arg.slice('--stores='.length).split(',');
    } else if (arg.startsWith('--searches=')) {
      options.searches = arg.slice('--searches='.length).split(',');
    } else if (arg.startsWith('--limit=')) {
      const value = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(value) && value > 0) options.limit = Math.min(value, 50);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Monitor de precios - scraper

Uso: npm run scrape -- [opciones]

  --dry-run           No escribe en Firestore, solo imprime los resultados.
  --stores=a,b        Solo estas tiendas (ids de config/stores.ts).
  --searches=a,b      Solo estas busquedas (ids de config/searches.ts).
  --limit=N           Resultados por consulta y tienda (por defecto 30, max 50).
  --help              Esta ayuda.
`);
}

function log(msg: string, extra?: Record<string, unknown>): void {
  const time = new Date().toISOString();
  if (extra && Object.keys(extra).length > 0) {
    console.log(`${time} ${msg} ${JSON.stringify(extra)}`);
  } else {
    console.log(`${time} ${msg}`);
  }
}

function selectSearches(available: SearchDefinition[], ids: string[] | null): SearchDefinition[] {
  if (!ids || ids.length === 0) return available.filter((search) => search.enabled);

  const wanted = new Set(ids.map((id) => id.trim()).filter(Boolean));
  const selected = available.filter((search) => wanted.has(search.id));

  const unknown = [...wanted].filter((id) => !available.some((s) => s.id === id));
  if (unknown.length > 0) {
    throw new Error(
      `Busqueda(s) desconocida(s): ${unknown.join(', ')}. ` +
        `Disponibles: ${available.map((s) => s.id).join(', ')}`,
    );
  }

  return selected;
}

interface SearchSource {
  searches: SearchDefinition[];
  /** Si vinieron de Firestore. Las del codigo son un respaldo y no viven alli. */
  stored: boolean;
}

/**
 * Trae las busquedas desde Firestore, que es donde las administra el usuario
 * desde el panel. Solo si Firestore no responde se cae a las definiciones del
 * codigo, para que un dry-run sin credenciales siga siendo util.
 *
 * Que Firestore responda y no haya ninguna no es lo mismo: significa que el
 * usuario las borro todas, y ahi corresponde no buscar nada en vez de volver
 * a las de ejemplo.
 */
async function fetchSearches(): Promise<SearchSource> {
  try {
    const db = getDb();
    const created = await bootstrapSearches(db);
    if (created > 0) log(`Coleccion vacia: se sembraron ${created} busquedas de ejemplo`);

    return { searches: await loadSearches(db), stored: true };
  } catch (error) {
    log(
      `No se pudieron leer las busquedas de Firestore, se usan las del codigo: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return { searches: SEARCHES, stored: false };
  }
}

const CLP = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

function printOffers(offers: NormalizedOffer[]): void {
  const rows = [...offers]
    .sort((a, b) => a.price - b.price)
    .map((offer) => ({
      Tienda: offer.storeLabel,
      Precio: CLP.format(offer.price),
      Normal: offer.listPrice ? CLP.format(offer.listPrice) : '-',
      Desc: offer.discountPct === null ? '-' : `${offer.discountPct}%`,
      Oferta: offer.isOffer ? 'si' : 'no',
      Busqueda: offer.searchIds.join(','),
      Titulo: offer.title.slice(0, 60),
    }));

  console.table(rows);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const stores = resolveStores(options.stores);
  const source = await fetchSearches();
  const searches = selectSearches(source.searches, options.searches);

  if (searches.length === 0) {
    log('No hay busquedas activas. Crea una desde el panel y vuelve a ejecutar.');

    // Sin busquedas no hay nada que buscar, pero si puede haber productos de
    // las que se borraron esperando que alguien los saque.
    if (!options.dryRun && source.stored) {
      const removed = await deleteOrphanProducts(getDb());
      if (removed > 0) log(`Borrados ${removed} productos de busquedas eliminadas`);
    }
    return;
  }

  log(
    `Iniciando corrida: ${stores.length} tienda(s) [${stores.map((s) => s.id).join(', ')}], ` +
      `${searches.length} busqueda(s) [${searches.map((s) => s.id).join(', ')}]` +
      (options.dryRun ? ' (dry-run)' : ''),
  );

  const result = await runScrape({
    stores,
    searches,
    limit: options.limit,
    dryRun: options.dryRun,
    log,
  });

  const found = result.stores.reduce((sum, store) => sum + store.found, 0);
  log(`Encontrados ${found} resultados, ${result.offers.length} productos relevantes unicos`);

  if (options.dryRun) {
    printOffers(result.offers);
    const summary = buildSummary(
      result,
      { found, kept: result.offers.length, created: 0, updated: 0, priceChanges: 0, drops: 0, rises: 0 },
      true,
      new Date(),
    );
    log(`Dry-run terminado con estado "${summary.status}"`);
    if (summary.errors.length > 0) {
      log(`Errores (${summary.errors.length}):`);
      for (const error of summary.errors) console.log(`  - ${error}`);
    }
    // Un dry-run sin ningun resultado suele significar que todos los
    // adaptadores se rompieron: conviene que CI lo note.
    if (result.offers.length === 0) process.exitCode = 1;
    return;
  }

  const db = getDb();
  const now = new Date();

  // Solo se anota la fecha de las busquedas que existen como documento. Con
  // las del codigo se crearian documentos con `lastRunAt` y nada mas: la web
  // los mostraria como pestanas vacias y bloquearian la siembra inicial.
  if (source.stored) await markSearchesRun(db, searches, now);

  const stats = await persistOffers(
    db,
    result.offers,
    result.runId,
    now,
    new Set(result.completedSearchIds),
  );

  const orphans = await deleteOrphanProducts(db);
  if (orphans > 0) log(`Borrados ${orphans} productos que ya no pertenecen a ninguna busqueda`);

  const summary = buildSummary(
    result,
    { found, kept: result.offers.length, ...stats },
    false,
    new Date(),
  );
  await saveRunSummary(db, summary);

  log(
    `Guardado: ${stats.created} nuevos, ${stats.updated} actualizados, ` +
      `${stats.priceChanges} cambios de precio (${stats.drops} bajas / ${stats.rises} alzas)`,
  );
  log(`Corrida ${summary.runId} terminada con estado "${summary.status}"`);

  if (summary.status === 'error') process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error('Fallo la corrida:', error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  // Sin esto el proceso queda vivo esperando al navegador, y en el cron eso
  // seria un job colgado hasta agotar el tiempo limite.
  .finally(() => closeBrowser());
