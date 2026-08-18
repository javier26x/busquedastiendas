/**
 * Siembra Firestore con las busquedas de ejemplo y un set de productos.
 *
 * Sirve para dejar el panel navegable antes de la primera corrida real
 * (util para verificar login, reglas y ordenamientos). Los productos quedan
 * bajo la tienda que indica cada fixture y se pueden borrar despues.
 *
 *   npm run seed
 */
import { resolveStores } from './config/stores.js';
import { getDb } from './firestore/client.js';
import { bootstrapSearches, loadSearches } from './firestore/searches.js';
import { markSearchesRun, persistOffers, saveRunSummary } from './pipeline/persist.js';
import { buildSummary, runScrape } from './pipeline/run.js';

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function main(): Promise<void> {
  const db = getDb();

  const created = await bootstrapSearches(db);
  log(
    created > 0
      ? `Sembradas ${created} busquedas de ejemplo`
      : 'Ya habia busquedas: no se toca ninguna',
  );

  const searches = (await loadSearches(db)).filter((search) => search.enabled);
  if (searches.length === 0) {
    log('No hay busquedas activas; nada que sembrar.');
    return;
  }

  log('Cargando productos de ejemplo desde fixtures...');
  const result = await runScrape({
    stores: resolveStores(['fixture']),
    searches,
    limit: 50,
    dryRun: false,
    log: (msg) => log(msg),
  });

  const now = new Date();

  // Sin esto el panel muestra "Pendiente de la primera corrida" al lado de los
  // productos que acaba de sembrar, que es justo lo contrario de lo que pasa.
  await markSearchesRun(db, searches, now);

  const stats = await persistOffers(
    db,
    result.offers,
    result.runId,
    now,
    new Set(result.completedSearchIds),
  );
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
