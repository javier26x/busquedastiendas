import type { Firestore } from 'firebase-admin/firestore';
import type { MatchRules, SearchDefinition } from '../types.js';
import { SEARCHES as CODE_SEARCHES } from '../config/searches.js';
import { normalizeText } from '../lib/text.js';
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

  const stored = parseMatchRules(data['match']);

  return {
    id,
    label,
    queries,
    // Una busqueda sin reglas acepta cualquier titulo que devuelva la tienda
    // y contamina el panel con productos ajenos. Nunca se deja sin filtro.
    match: stored.requireAll.length > 0 ? stored : fallbackMatchRules(id, label, stored.exclude),
    enabled: data['enabled'] !== false,
  };
}

/**
 * Reglas para una busqueda guardada sin ellas.
 *
 * Se prefieren las curadas del codigo cuando el id coincide, porque son mas
 * ricas que lo que se puede deducir de un nombre. Si no, se derivan del
 * nombre igual que hace el panel al crear una busqueda.
 */
function fallbackMatchRules(id: string, label: string, exclude: string[]): MatchRules {
  const known = CODE_SEARCHES.find((search) => search.id === id);
  if (known) {
    return {
      requireAll: known.match.requireAll,
      exclude: exclude.length > 0 ? exclude : known.match.exclude,
    };
  }

  return { requireAll: deriveRequireAll(label), exclude };
}

/** Palabras sin valor para discriminar un titulo. */
const STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'un', 'una', 'unos', 'unas',
  'para', 'con', 'sin', 'y', 'o', 'en', 'por', 'a', 'al', 'que',
]);

/**
 * Cada palabra significativa del nombre pasa a ser un requisito, usando su
 * raiz para que el singular tambien calce. Es la misma regla que aplica el
 * panel; aqui existe para los documentos que se guardaron sin ella.
 */
export function deriveRequireAll(label: string): string[][] {
  const words = [
    ...new Set(
      normalizeText(label)
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 1 && !STOPWORDS.has(word)),
    ),
  ];

  return words.map((word) => [stemWord(word)]);
}

function stemWord(word: string): string {
  if (word.length <= 4) return word;
  if (word.endsWith('ces')) return `${word.slice(0, -3)}z`;
  if (word.endsWith('es')) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * Firestore no admite arreglos anidados, asi que cada grupo de `requireAll`
 * se guarda envuelto en `{ anyOf: [...] }`. Se acepta tambien la forma
 * anidada por si quedo algun documento de una version anterior.
 */
export function parseMatchRules(value: unknown): MatchRules {
  if (!value || typeof value !== 'object') return { requireAll: [], exclude: [] };

  const raw = value as Record<string, unknown>;
  const groups = Array.isArray(raw['requireAll']) ? raw['requireAll'] : [];

  const requireAll = groups
    .map((group) => {
      if (Array.isArray(group)) return asStringArray(group);
      if (group && typeof group === 'object') {
        return asStringArray((group as Record<string, unknown>)['anyOf']);
      }
      return [];
    })
    .filter((group) => group.length > 0);

  return { requireAll, exclude: asStringArray(raw['exclude']) };
}

/** Convierte las reglas al formato plano que acepta Firestore. */
export function serializeMatchRules(rules: MatchRules): Record<string, unknown> {
  return {
    requireAll: rules.requireAll
      .filter((group) => group.length > 0)
      .map((group) => ({ anyOf: group })),
    exclude: rules.exclude,
  };
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
      match: serializeMatchRules(search.match),
      enabled: search.enabled,
      source: 'semilla',
      createdAt: now,
      updatedAt: now,
    });
  }

  await batch.commit();
  return CODE_SEARCHES.length;
}
