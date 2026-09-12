import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideOrphanScan, FULL_SCAN_EVERY_MS } from '../src/pipeline/retention.js';

const now = new Date('2026-09-12T12:00:00Z');
const ayer = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const haceDosSemanas = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

test('sin estado previo se barre: no hay con que comparar', () => {
  const decision = decideOrphanScan(null, ['a', 'b'], now);
  assert.equal(decision.scan, true);
});

test('si desaparecio una busqueda se barre', () => {
  const decision = decideOrphanScan(
    { searchIds: ['a', 'b'], lastFullScanAt: ayer },
    ['a'],
    now,
  );

  assert.equal(decision.scan, true);
  assert.match(decision.reason, /\bb\b/);
});

test('si las busquedas siguen todas, no se barre', () => {
  const decision = decideOrphanScan(
    { searchIds: ['a', 'b'], lastFullScanAt: ayer },
    ['a', 'b'],
    now,
  );

  assert.equal(decision.scan, false);
});

test('una busqueda nueva no obliga a barrer', () => {
  // Agregar no deja huerfanos: los productos siguen teniendo sus etiquetas.
  const decision = decideOrphanScan(
    { searchIds: ['a'], lastFullScanAt: ayer },
    ['a', 'b'],
    now,
  );

  assert.equal(decision.scan, false);
});

test('se barre igual cada tanto, por si el panel quedo a medias', () => {
  const decision = decideOrphanScan(
    { searchIds: ['a'], lastFullScanAt: haceDosSemanas },
    ['a'],
    now,
  );

  assert.equal(decision.scan, true);
  assert.match(decision.reason, /periodico/);
});

test('justo en el limite del periodo se barre', () => {
  const limite = new Date(now.getTime() - FULL_SCAN_EVERY_MS);
  const decision = decideOrphanScan({ searchIds: ['a'], lastFullScanAt: limite }, ['a'], now);

  assert.equal(decision.scan, true);
});

test('un estado sin fecha de barrido cuenta como nunca barrido', () => {
  const decision = decideOrphanScan({ searchIds: ['a'], lastFullScanAt: null }, ['a'], now);
  assert.equal(decision.scan, true);
});

test('borrar todas las busquedas se detecta', () => {
  const decision = decideOrphanScan({ searchIds: ['a', 'b'], lastFullScanAt: ayer }, [], now);
  assert.equal(decision.scan, true);
});
