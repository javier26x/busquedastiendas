import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScrape } from '../src/pipeline/run.js';
import type { RawOffer, SearchDefinition, StoreAdapter } from '../src/types.js';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function search(id: string, queries: string[]): SearchDefinition {
  return {
    id,
    label: id,
    queries,
    // Sin reglas, todo titulo pasa: aca se prueba el runner, no el filtro.
    match: { requireAll: [], exclude: [] },
    enabled: true,
  };
}

function offer(externalId: string, price: number): RawOffer {
  return {
    externalId,
    title: `Producto ${externalId}`,
    url: `https://tienda.cl/${externalId}`,
    image: null,
    brand: null,
    price,
    listPrice: null,
    currency: 'CLP',
    available: true,
  };
}

/** Tienda de mentira que registra cuando entra y sale de cada consulta. */
function fakeStore(
  id: string,
  handler: (query: string) => Promise<RawOffer[]>,
): StoreAdapter {
  return { id, label: id.toUpperCase(), enabled: true, search: (query) => handler(query) };
}

const silent = (): void => undefined;

test('las tiendas se consultan en paralelo', async () => {
  let inFlight = 0;
  let peak = 0;

  const stores = ['a', 'b', 'c'].map((id) =>
    fakeStore(id, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
      return [offer(`${id}-1`, 1000)];
    }),
  );

  await runScrape({
    stores,
    searches: [search('s1', ['q'])],
    limit: 10,
    dryRun: true,
    concurrency: 3,
    log: silent,
  });

  assert.equal(peak, 3, 'las tres tiendas deberian estar en vuelo a la vez');
});

test('dentro de una tienda las consultas siguen en serie', async () => {
  // Importa porque comparten host —y estado: los adaptadores con varias
  // estrategias recuerdan cual les funciono.
  const trace: string[] = [];

  const store = fakeStore('a', async (query) => {
    trace.push(`inicio ${query}`);
    await tick();
    trace.push(`fin ${query}`);
    return [];
  });

  await runScrape({
    stores: [store],
    searches: [search('s1', ['uno', 'dos'])],
    limit: 10,
    dryRun: true,
    concurrency: 4,
    log: silent,
  });

  assert.deepEqual(trace, ['inicio uno', 'fin uno', 'inicio dos', 'fin dos']);
});

test('el resumen por tienda conserva el orden de configuracion', async () => {
  // La lenta va primera: si el orden fuera el de terminacion, quedaria ultima.
  const stores = [
    fakeStore('lenta', async () => {
      for (let i = 0; i < 5; i += 1) await tick();
      return [offer('l-1', 1000)];
    }),
    fakeStore('rapida', async () => [offer('r-1', 2000)]),
  ];

  const result = await runScrape({
    stores,
    searches: [search('s1', ['q'])],
    limit: 10,
    dryRun: true,
    concurrency: 2,
    log: silent,
  });

  assert.deepEqual(
    result.stores.map((stat) => stat.storeId),
    ['lenta', 'rapida'],
  );
});

test('una tienda que falla no arrastra a las demas', async () => {
  const stores = [
    fakeStore('rota', async () => {
      throw new Error('HTTP 403');
    }),
    fakeStore('sana', async () => [offer('s-1', 5000)]),
  ];

  const result = await runScrape({
    stores,
    searches: [search('s1', ['q'])],
    limit: 10,
    dryRun: true,
    concurrency: 2,
    log: silent,
  });

  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0]?.storeId, 'sana');

  const rota = result.stores.find((stat) => stat.storeId === 'rota');
  assert.equal(rota?.ok, false);
  assert.match(rota?.error ?? '', /HTTP 403/);

  assert.equal(result.stores.find((stat) => stat.storeId === 'sana')?.ok, true);
  assert.deepEqual(result.errors, ['rota / "q": HTTP 403']);
});

test('una busqueda que fallo en cualquier tienda no cuenta como completa', async () => {
  // De eso depende poder quitarle la etiqueta a un producto que no aparecio:
  // si la consulta fallo, la ausencia puede ser del error y no del catalogo.
  const stores = [
    fakeStore('a', async (query) => {
      if (query === 'q2') throw new Error('timeout');
      return [offer('a-1', 1000)];
    }),
    fakeStore('b', async () => [offer('b-1', 1000)]),
  ];

  const result = await runScrape({
    stores,
    searches: [search('s1', ['q1']), search('s2', ['q2'])],
    limit: 10,
    dryRun: true,
    concurrency: 2,
    log: silent,
  });

  assert.deepEqual(result.completedSearchIds, ['s1']);
});

test('el mismo producto en dos busquedas queda una vez con ambas etiquetas', async () => {
  const store = fakeStore('a', async () => [offer('x', 1000)]);

  const result = await runScrape({
    stores: [store],
    searches: [search('s1', ['q1']), search('s2', ['q2'])],
    limit: 10,
    dryRun: true,
    concurrency: 2,
    log: silent,
  });

  assert.equal(result.offers.length, 1);
  assert.deepEqual(result.offers[0]?.searchIds.sort(), ['s1', 's2']);
});

test('el id de corrida es ordenable y sin caracteres prohibidos', async () => {
  const result = await runScrape({
    stores: [],
    searches: [search('s1', ['q'])],
    limit: 10,
    dryRun: true,
    log: silent,
  });

  assert.match(result.runId, /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/);
  assert.equal(result.runId.includes('/'), false);
});
