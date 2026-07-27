import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import type {
  NormalizedOffer,
  ProductRecord,
  RunSummary,
  SearchDefinition,
} from '../types.js';
import { buildRecord, type ChangeKind } from './diff.js';

export const COLLECTIONS = {
  products: 'products',
  history: 'history',
  searches: 'searches',
  runs: 'runs',
} as const;

/** Firestore limita a 500 operaciones por batch; dejamos margen. */
const BATCH_LIMIT = 200;
/** `getAll` acepta muchos refs, pero conviene no armar payloads gigantes. */
const READ_CHUNK = 250;

export interface PersistStats {
  created: number;
  updated: number;
  priceChanges: number;
  drops: number;
  rises: number;
}

/** Guarda los productos y su historial, devolviendo el resumen de cambios. */
export async function persistOffers(
  db: Firestore,
  offers: NormalizedOffer[],
  runId: string,
  now: Date,
): Promise<PersistStats> {
  const stats: PersistStats = { created: 0, updated: 0, priceChanges: 0, drops: 0, rises: 0 };
  if (offers.length === 0) return stats;

  const products = db.collection(COLLECTIONS.products);
  const existing = await readExisting(db, offers.map((offer) => products.doc(offer.key)));

  let batch = db.batch();
  let ops = 0;

  const flush = async (): Promise<void> => {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const offer of offers) {
    const ref = products.doc(offer.key);
    const { record, history, kind } = buildRecord(existing.get(offer.key) ?? null, offer, now, runId);

    batch.set(ref, toFirestore(record), { merge: true });
    ops += 1;

    if (history) {
      batch.set(ref.collection(COLLECTIONS.history).doc(), {
        ...history,
        capturedAt: Timestamp.fromDate(history.capturedAt),
      });
      ops += 1;
    }

    countChange(stats, kind);

    if (ops >= BATCH_LIMIT) await flush();
  }

  await flush();
  return stats;
}

function countChange(stats: PersistStats, kind: ChangeKind): void {
  if (kind === 'created') {
    stats.created += 1;
    return;
  }

  stats.updated += 1;
  if (kind === 'drop') {
    stats.priceChanges += 1;
    stats.drops += 1;
  } else if (kind === 'rise') {
    stats.priceChanges += 1;
    stats.rises += 1;
  }
}

/** Lee los productos ya existentes en bloques. */
async function readExisting(
  db: Firestore,
  refs: DocumentReference[],
): Promise<Map<string, ProductRecord>> {
  const found = new Map<string, ProductRecord>();

  for (let i = 0; i < refs.length; i += READ_CHUNK) {
    const chunk = refs.slice(i, i + READ_CHUNK);
    if (chunk.length === 0) continue;

    const snapshots = await db.getAll(...chunk);
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      found.set(snapshot.id, fromFirestore(snapshot.data() ?? {}));
    }
  }

  return found;
}

/** Convierte fechas a Timestamp antes de escribir. */
function toFirestore(record: ProductRecord): Record<string, unknown> {
  return {
    ...record,
    firstSeenAt: Timestamp.fromDate(record.firstSeenAt),
    lastSeenAt: Timestamp.fromDate(record.lastSeenAt),
    priceChangedAt: record.priceChangedAt ? Timestamp.fromDate(record.priceChangedAt) : null,
  };
}

/** Convierte lo leido de Firestore al tipo del dominio. */
function fromFirestore(data: Record<string, unknown>): ProductRecord {
  const record = data as unknown as ProductRecord;
  return {
    ...record,
    searchIds: Array.isArray(record.searchIds) ? record.searchIds : [],
    firstSeenAt: toDate(data['firstSeenAt']) ?? new Date(0),
    lastSeenAt: toDate(data['lastSeenAt']) ?? new Date(0),
    priceChangedAt: toDate(data['priceChangedAt']),
  };
}

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

/**
 * Registra cuando se ejecuto cada busqueda.
 *
 * Solo toca ese campo: la definicion (nombre, terminos, reglas) la maneja el
 * usuario desde la web y el scraper no debe pisarla.
 */
export async function markSearchesRun(
  db: Firestore,
  searches: SearchDefinition[],
  now: Date,
): Promise<void> {
  if (searches.length === 0) return;

  const batch = db.batch();

  for (const search of searches) {
    batch.set(
      db.collection(COLLECTIONS.searches).doc(search.id),
      { lastRunAt: Timestamp.fromDate(now) },
      { merge: true },
    );
  }

  await batch.commit();
}

/** Guarda el resumen de la corrida (la web lo muestra como "ultima ejecucion"). */
export async function saveRunSummary(db: Firestore, summary: RunSummary): Promise<void> {
  await db
    .collection(COLLECTIONS.runs)
    .doc(summary.runId)
    .set({
      ...summary,
      startedAt: Timestamp.fromDate(summary.startedAt),
      finishedAt: Timestamp.fromDate(summary.finishedAt),
    });
}
