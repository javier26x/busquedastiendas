import type { Firestore } from 'firebase-admin/firestore';
import type { MatchRules, SearchDefinition } from '../types.js';
import { SEARCHES as CODE_SEARCHES } from '../config/searches.js';
import { COLLECTIONS } from '../pipeline/persist.js';

/**
 * Las busquedas viven en Firestore, no en el codigo.
 *
 * Asi se pueden crear y editar desde el panel sin desplegar nada. Las
 * definiciones de `config/searches.ts` quedan solo como semilla inicial para
 * un proyecto vacio.
 */
export async function loadSearches(db: Firestore): Promise<SearchDefinition[]> {
  const snapshot = await db.collection(COLLECTIONS.searches).get();

  const searches = snapshot.docs.flatMap((doc) => {
    const parsed = parseSearchDoc(doc.id, doc.data());
    return parsed ? [parsed] : [];
  });

  return searches.sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

/**
 * Valida un documento de busqueda.
 *
 * Se descarta lo que no sirva en vez de dejarlo reventar a mitad de corrida:
 * estos documentos los escribe la web y no hay garantia de su forma.
 */
export function parseSearchDoc(id: string, data: Record<string, unknown>): SearchDefinition | null {
  const label = asNonEmptyString(data['label']) ?? id;
  const queries = asStringArray(data['queries']).filter(Boolean);

  if (queries.length === 0) return null;

  return {
    id,
    label,
    queries,
    match: parseMatchRules(data['match']),
    enabled: data['enabled'] !== false,
  };
}

function parseMatchRules(value: unknown): MatchRules {
  if (!value || typeof value !== 'object') return { requireAll: [], exclude: [] };

  const raw = value as Record<string, unknown>;
  const requireAll = Array.isArray(raw['requireAll'])
    ? raw['requireAll'].map((group) => asStringArray(group)).filter((group) => group.length > 0)
    : [];

  return { requireAll, exclude: asStringArray(raw['exclude']) };
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const text = asNonEmptyString(entry);
    return text ? [text] : [];
  });
}

/**
 * Crea las busquedas de ejemplo solo si la coleccion esta vacia.
 *
 * Importante que no sobrescriba: si el usuario edito o borro una busqueda
 * desde la web, la proxima corrida no debe resucitarla.
 */
export async function bootstrapSearches(db: Firestore): Promise<number> {
  const collection = db.collection(COLLECTIONS.searches);
  const existing = await collection.limit(1).get();

  if (!existing.empty) return 0;

  const batch = db.batch();
  const now = new Date();

  for (const search of CODE_SEARCHES) {
    batch.set(collection.doc(search.id), {
      id: search.id,
      label: search.label,
      queries: search.queries,
      match: search.match,
      enabled: search.enabled,
      source: 'semilla',
      createdAt: now,
      updatedAt: now,
    });
  }

  await batch.commit();
  return CODE_SEARCHES.length;
}
