/**
 * Siembra Firestore con las busquedas y un set de productos de ejemplo.
 *
 * Sirve para dejar el panel navegable antes de la primera corrida real
 * (util para verificar login, reglas y ordenamientos). Los productos quedan
 * bajo la tienda que indica cada fixture y se pueden borrar despues.
 *
 *   npm run seed
 */
import { SEARCHES, enabledSearches } from './config/searches.js';
import { resolveStores } from './config/stores.js';
import { getDb } from './firestore/client.js';
import { persistOffers, saveRunSummary, syncSearches } from './pipeline/persist.js';
import { buildSummary, runScrape } from './pipeline/run.js';

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function main(): Promise<void> {
  const db = getDb();

  log('Sincronizando definiciones de busqueda...');
  await syncSearches(db, SEARCHES);

  log('Cargando productos de ejemplo desde fixtures...');
  const result = await runScrape({
    stores: resolveStores(['fixture']),
    searches: enabledSearches(),
    limit: 50,
    dryRun: false,
    log: (msg) => log(msg),
  });

  const now = new Date();
  const stats = await persistOffers(db, result.offers, result.runId, now);
  const found = result.stores.reduce((sum, store) => sum + store.found, 0);

  await saveRunSummary(
    db,
    buildSummary(result, { found, kept: result.offers.length, ...stats }, false, new Date()),
  );

  log(`Listo: ${stats.created} productos creados, ${stats.updated} actualizados.`);
  log('Abre la web y entra con tu correo para verlos.');
}

main().catch((error: unknown) => {
  console.error('Fallo el seed:', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
