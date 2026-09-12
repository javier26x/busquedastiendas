import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../src/lib/pool.js';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test('mapWithConcurrency devuelve los resultados en el orden de entrada', async () => {
  // El primero tarda mas a proposito: si el orden fuera el de terminacion,
  // este caso lo delataria.
  const result = await mapWithConcurrency([3, 2, 1], 3, async (n) => {
    for (let i = 0; i < n; i += 1) await tick();
    return n * 10;
  });

  assert.deepEqual(result, [30, 20, 10]);
});

test('mapWithConcurrency no pasa del limite de tareas en vuelo', async () => {
  let inFlight = 0;
  let peak = 0;

  await mapWithConcurrency(Array.from({ length: 10 }, (_v, i) => i), 3, async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await tick();
    inFlight -= 1;
  });

  assert.equal(peak, 3);
});

test('un limite de 1 ejecuta en serie', async () => {
  const order: number[] = [];

  await mapWithConcurrency([1, 2, 3], 1, async (n) => {
    order.push(n);
    await tick();
    order.push(-n);
  });

  // En serie, cada tarea termina antes de que empiece la siguiente.
  assert.deepEqual(order, [1, -1, 2, -2, 3, -3]);
});

test('un limite invalido degrada a secuencial en vez de colgarse', async () => {
  assert.deepEqual(await mapWithConcurrency([1, 2], 0, async (n) => n), [1, 2]);
  assert.deepEqual(await mapWithConcurrency([1, 2], Number.NaN, async (n) => n), [1, 2]);
});

test('una lista vacia no llama al worker', async () => {
  let calls = 0;
  const result = await mapWithConcurrency([], 4, async () => {
    calls += 1;
    return 1;
  });

  assert.deepEqual(result, []);
  assert.equal(calls, 0);
});
