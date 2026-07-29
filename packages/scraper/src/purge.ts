/**
 * Borra los productos de una tienda, con su historial de precios.
 *
 *   npm run purge -- --store=ikea
 *   npm run purge -- --store=ikea --dry-run
 *
 * Sirve cuando un adaptador guardo datos incorrectos: si solo se corrige el
 * codigo, los precios malos quedan en el historial y la siguiente corrida los
 * reporta como bajadas enormes que en realidad son correcciones. Borrarlos
 * deja que se vuelvan a crear limpios.
 */
import { getDb } from './firestore/client.js';
import { COLLECTIONS } from './pipeline/persist.js';

interface Options {
  store: string | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { store: null, dryRun: false };

  for (const arg of argv) {
    if (arg.startsWith('--store=')) options.store = arg.slice('--store='.length).trim();
    else if (arg === '--dry-run') options.dryRun = true;
  }

  return options;
}

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!options.store) {
    console.error('Falta --store=<id>. Ejemplo: npm run purge -- --store=ikea');
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const snapshot = await db
    .collection(COLLECTIONS.products)
    .where('storeId', '==', options.store)
    .get();

  if (snapshot.empty) {
    log(`No hay productos de "${options.store}".`);
    return;
  }

  log(`${snapshot.size} producto(s) de "${options.store}"`);

  if (options.dryRun) {
    for (const doc of snapshot.docs.slice(0, 10)) {
      const data = doc.data();
      log(`  ${String(data['price'])} - ${String(data['title']).slice(0, 60)}`);
    }
    if (snapshot.size > 10) log(`  ... y ${snapshot.size - 10} mas`);
    log('Dry-run: no se borro nada.');
    return;
  }

  // recursiveDelete arrastra la subcoleccion `history` de cada producto; sin
  // eso quedarian huerfanos los registros de precios anteriores.
  let deleted = 0;
  for (const doc of snapshot.docs) {
    await db.recursiveDelete(doc.ref);
    deleted += 1;
    if (deleted % 50 === 0) log(`  ${deleted}/${snapshot.size}`);
  }

  log(`Borrados ${deleted} producto(s) con su historial.`);
  log('Vuelve a correr el scraper para recrearlos con los datos corregidos.');
}

main().catch((error: unknown) => {
  console.error('Fallo la limpieza:', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
