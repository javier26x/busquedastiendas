import { useCallback, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { getDb } from '../firebase.js';
import { serializeMatchRules, type SearchDraft } from '../lib/searchRules.js';

/** Firestore limita a 500 operaciones por lote. */
const BATCH_LIMIT = 400;

interface SearchAdmin {
  saving: boolean;
  error: string | null;
  save: (draft: SearchDraft) => Promise<boolean>;
  remove: (searchId: string, alsoProducts: boolean) => Promise<boolean>;
  clearError: () => void;
}

export function useSearchAdmin(): SearchAdmin {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async (draft: SearchDraft): Promise<boolean> => {
    setSaving(true);
    setError(null);

    try {
      await setDoc(
        doc(getDb(), 'searches', draft.id),
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
   * Borra la busqueda y, opcionalmente, los productos que solo pertenecian a
   * ella. Los que ademas estan en otra busqueda se conservan quitandoles solo
   * esta etiqueta, para no perder su historial de precios.
   */
  const remove = useCallback(async (searchId: string, alsoProducts: boolean): Promise<boolean> => {
    setSaving(true);
    setError(null);

    try {
      const db = getDb();

      if (alsoProducts) {
        const snapshot = await getDocs(
          query(collection(db, 'products'), where('searchIds', 'array-contains', searchId)),
        );

        let batch = writeBatch(db);
        let ops = 0;

        for (const productDoc of snapshot.docs) {
          const ids: string[] = Array.isArray(productDoc.data()['searchIds'])
            ? (productDoc.data()['searchIds'] as string[])
            : [];
          const remaining = ids.filter((id) => id !== searchId);

          if (remaining.length === 0) {
            batch.delete(productDoc.ref);
          } else {
            batch.update(productDoc.ref, { searchIds: remaining });
          }

          ops += 1;
          if (ops >= BATCH_LIMIT) {
            await batch.commit();
            batch = writeBatch(db);
            ops = 0;
          }
        }

        if (ops > 0) await batch.commit();
      }

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
    return 'Sin permiso para modificar busquedas. Despliega las reglas actualizadas: firebase deploy --only firestore:rules';
  }
  if (code === 'unavailable') {
    return 'Sin conexion con Firestore. Intenta de nuevo.';
  }

  return error instanceof Error ? error.message : 'No se pudo guardar.';
}
