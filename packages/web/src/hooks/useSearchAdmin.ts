import { useCallback, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { getDb } from '../firebase.js';
import { serializeMatchRules, type SearchDraft } from '../lib/searchRules.js';

/** Firestore limita a 500 operaciones por lote. */
const BATCH_LIMIT = 400;

interface SearchAdmin {
  saving: boolean;
  error: string | null;
  save: (draft: SearchDraft, options?: SaveOptions) => Promise<boolean>;
  remove: (searchId: string) => Promise<boolean>;
  clearError: () => void;
}

interface SaveOptions {
  /** Marca que es una busqueda nueva, para no pisar una existente. */
  create?: boolean;
}

export function useSearchAdmin(): SearchAdmin {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async (draft: SearchDraft, options?: SaveOptions): Promise<boolean> => {
    setSaving(true);
    setError(null);

    try {
      const ref = doc(getDb(), 'searches', draft.id);

      // El id sale del nombre, asi que dos nombres parecidos ("Pañales" y
      // "pañales") caen en el mismo documento y el segundo borraria al
      // primero sin decir nada.
      if (options?.create) {
        const existing = await getDoc(ref);
        if (existing.exists()) {
          setError(
            `Ya existe una busqueda con ese nombre ("${
              (existing.data()['label'] as string | undefined) ?? draft.id
            }"). Usa otro o edita la que ya tienes.`,
          );
          return false;
        }
      }

      await setDoc(
        ref,
        {
          id: draft.id,
          label: draft.label.trim(),
          queries: draft.queries,
          // Firestore no admite arreglos anidados: se guarda como { anyOf }.
          match: serializeMatchRules(draft.match),
          enabled: draft.enabled,
          source: 'web',
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      return true;
    } catch (caught) {
      setError(describe(caught));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  /**
   * Borra la busqueda y desliga sus productos quitandoles esa etiqueta.
   *
   * El panel no borra productos: solo el scraper puede, porque eliminar el
   * documento desde el cliente dejaria huerfana su subcoleccion de historial.
   * Los que queden sin ninguna busqueda los limpia la proxima corrida; los
   * que pertenezcan a otra se conservan con su historial intacto.
   */
  const remove = useCallback(async (searchId: string): Promise<boolean> => {
    setSaving(true);
    setError(null);

    try {
      const db = getDb();
      const snapshot = await getDocs(
        query(collection(db, 'products'), where('searchIds', 'array-contains', searchId)),
      );

      let batch = writeBatch(db);
      let ops = 0;

      for (const productDoc of snapshot.docs) {
        const ids: string[] = Array.isArray(productDoc.data()['searchIds'])
          ? (productDoc.data()['searchIds'] as string[])
          : [];

        batch.update(productDoc.ref, { searchIds: ids.filter((id) => id !== searchId) });
        ops += 1;

        if (ops >= BATCH_LIMIT) {
          await batch.commit();
          batch = writeBatch(db);
          ops = 0;
        }
      }

      if (ops > 0) await batch.commit();

      await deleteDoc(doc(db, 'searches', searchId));
      return true;
    } catch (caught) {
      setError(describe(caught));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { saving, error, save, remove, clearError };
}

function describe(error: unknown): string {
  const code = (error as { code?: string }).code ?? '';

  if (code === 'permission-denied') {
    return 'Sin permiso. Despliega las reglas actualizadas: npx firebase-tools deploy --only firestore:rules';
  }
  if (code === 'unavailable') {
    return 'Sin conexion con Firestore. Intenta de nuevo.';
  }

  return error instanceof Error ? error.message : 'No se pudo guardar.';
}
