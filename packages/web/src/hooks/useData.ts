import { useEffect, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  type DocumentData,
} from 'firebase/firestore';
import { getDb } from '../firebase.js';
import { deserializeMatchRules } from '../lib/searchRules.js';
import type { Product, PricePoint, RunDoc, SearchDoc } from '../types.js';

/** Tope defensivo: el panel ordena en memoria, no queremos traer de mas. */
const MAX_PRODUCTS = 1000;

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toProduct(id: string, data: DocumentData): Product {
  return {
    key: id,
    storeId: String(data['storeId'] ?? 'desconocida'),
    storeLabel: String(data['storeLabel'] ?? data['storeId'] ?? 'Desconocida'),
    externalId: String(data['externalId'] ?? ''),
    searchIds: Array.isArray(data['searchIds']) ? (data['searchIds'] as string[]) : [],
    title: String(data['title'] ?? 'Sin titulo'),
    url: String(data['url'] ?? '#'),
    image: typeof data['image'] === 'string' ? data['image'] : null,
    brand: typeof data['brand'] === 'string' ? data['brand'] : null,
    currency: String(data['currency'] ?? 'CLP'),
    available: data['available'] !== false,

    price: Number(data['price'] ?? 0),
    listPrice: toNumberOrNull(data['listPrice']),
    isOffer: data['isOffer'] === true,
    discountPct: toNumberOrNull(data['discountPct']),

    previousPrice: toNumberOrNull(data['previousPrice']),
    priceChange: toNumberOrNull(data['priceChange']),
    priceChangePct: toNumberOrNull(data['priceChangePct']),
    priceChangedAt: toDate(data['priceChangedAt']),

    minPrice: Number(data['minPrice'] ?? data['price'] ?? 0),
    maxPrice: Number(data['maxPrice'] ?? data['price'] ?? 0),
    firstSeenAt: toDate(data['firstSeenAt']) ?? new Date(0),
    lastSeenAt: toDate(data['lastSeenAt']) ?? new Date(0),
  };
}

function toSearch(id: string, data: DocumentData): SearchDoc {
  return {
    id,
    label: String(data['label'] ?? id),
    queries: Array.isArray(data['queries']) ? (data['queries'] as string[]) : [],
    match: deserializeMatchRules(data['match']),
    enabled: data['enabled'] !== false,
    lastRunAt: toDate(data['lastRunAt']),
  };
}

interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

/** Escucha en vivo todos los productos monitoreados. */
export function useProducts(): AsyncState<Product[]> {
  const [state, setState] = useState<AsyncState<Product[]>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    const q = query(
      collection(getDb(), 'products'),
      orderBy('lastSeenAt', 'desc'),
      limit(MAX_PRODUCTS),
    );

    return onSnapshot(
      q,
      (snapshot) => {
        setState({
          data: snapshot.docs.map((doc) => toProduct(doc.id, doc.data())),
          loading: false,
          error: null,
        });
      },
      (error) => {
        setState({ data: [], loading: false, error: describeFirestoreError(error) });
      },
    );
  }, []);

  return state;
}

/** Definiciones de busqueda, para las pestanas del panel. */
export function useSearches(): AsyncState<SearchDoc[]> {
  const [state, setState] = useState<AsyncState<SearchDoc[]>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    return onSnapshot(
      collection(getDb(), 'searches'),
      (snapshot) => {
        // Se traen tambien las pausadas: el administrador necesita verlas
        // para poder reactivarlas. El panel filtra por `enabled` al pintar.
        const searches = snapshot.docs
          .map((doc) => toSearch(doc.id, doc.data()))
          .sort((a, b) => a.label.localeCompare(b.label, 'es'));

        setState({ data: searches, loading: false, error: null });
      },
      (error) => setState({ data: [], loading: false, error: describeFirestoreError(error) }),
    );
  }, []);

  return state;
}

/** Ultima corrida del scraper, para mostrar estado y fecha. */
export function useLastRun(): AsyncState<RunDoc | null> {
  const [state, setState] = useState<AsyncState<RunDoc | null>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const q = query(collection(getDb(), 'runs'), orderBy('finishedAt', 'desc'), limit(1));

    return onSnapshot(
      q,
      (snapshot) => {
        const doc = snapshot.docs[0];
        if (!doc) {
          setState({ data: null, loading: false, error: null });
          return;
        }

        const data = doc.data();
        setState({
          data: {
            runId: doc.id,
            finishedAt: toDate(data['finishedAt']) ?? new Date(0),
            status: (data['status'] as RunDoc['status']) ?? 'ok',
            totals: (data['totals'] as RunDoc['totals']) ?? {
              found: 0,
              kept: 0,
              created: 0,
              updated: 0,
              priceChanges: 0,
              drops: 0,
              rises: 0,
            },
            stores: Array.isArray(data['stores']) ? (data['stores'] as RunDoc['stores']) : [],
          },
          loading: false,
          error: null,
        });
      },
      (error) => setState({ data: null, loading: false, error: describeFirestoreError(error) }),
    );
  }, []);

  return state;
}

/**
 * Historial de precios de un producto.
 * Se carga bajo demanda al abrir el detalle, no en el listado.
 */
export function usePriceHistory(productKey: string | null): AsyncState<PricePoint[]> {
  const [state, setState] = useState<AsyncState<PricePoint[]>>({
    data: [],
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!productKey) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    setState({ data: [], loading: true, error: null });

    const q = query(
      collection(getDb(), 'products', productKey, 'history'),
      orderBy('capturedAt', 'asc'),
      limit(365),
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const points = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            price: Number(data['price'] ?? 0),
            listPrice: toNumberOrNull(data['listPrice']),
            isOffer: data['isOffer'] === true,
            capturedAt: toDate(data['capturedAt']) ?? new Date(0),
          };
        });

        setState({ data: points, loading: false, error: null });
      },
      (error) => setState({ data: [], loading: false, error: describeFirestoreError(error) }),
    );
  }, [productKey]);

  return state;
}

function describeFirestoreError(error: unknown): string {
  const code = (error as { code?: string }).code ?? '';

  if (code === 'permission-denied') {
    return 'Tu cuenta no tiene permiso para leer estos datos. Revisa que tu correo este autorizado en firestore.rules.';
  }
  if (code === 'failed-precondition') {
    return 'Falta un indice en Firestore. Despliega firestore.indexes.json con: firebase deploy --only firestore:indexes';
  }
  if (code === 'unavailable') {
    return 'Sin conexion con Firestore. Reintentando...';
  }

  return error instanceof Error ? error.message : 'Error al leer los datos.';
}
