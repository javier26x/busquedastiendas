import { useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth.js';
import { useLastRun, useProducts, useSearches } from '../hooks/useData.js';
import {
  DEFAULT_FILTERS,
  computeStats,
  filterProducts,
  sortProducts,
  storeOptions,
  type Filters,
  type SortKey,
} from '../lib/sort.js';
import { formatRelative } from '../lib/format.js';
import { StatsBar } from './StatsBar.js';
import { FiltersBar } from './FiltersBar.js';
import { ProductTable } from './ProductTable.js';
import { ProductDetail } from './ProductDetail.js';
import { RunStatus } from './RunStatus.js';
import { SearchManager } from './SearchManager.js';
import type { Product } from '../types.js';

export function Dashboard(): ReactNode {
  const { user, logout } = useAuth();
  const products = useProducts();
  const searches = useSearches();
  const lastRun = useLastRun();

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>('precio-asc');
  const [selected, setSelected] = useState<Product | null>(null);
  const [managing, setManaging] = useState(false);

  const stores = useMemo(() => storeOptions(products.data), [products.data]);

  // El filtro por busqueda define el universo sobre el que se calculan las
  // estadisticas; el resto de filtros solo afinan la tabla.
  const inSearch = useMemo(
    () =>
      filters.searchId
        ? products.data.filter((product) => product.searchIds.includes(filters.searchId as string))
        : products.data,
    [products.data, filters.searchId],
  );

  const visible = useMemo(
    () => sortProducts(filterProducts(products.data, filters), sortKey),
    [products.data, filters, sortKey],
  );

  const stats = useMemo(() => computeStats(inSearch), [inSearch]);

  const productCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products.data) {
      for (const id of product.searchIds) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }, [products.data]);

  // Las pausadas se administran pero no ocupan una pestana.
  const searchTabs = useMemo(
    () =>
      searches.data
        .filter((search) => search.enabled)
        .map((search) => ({ ...search, count: productCounts.get(search.id) ?? 0 })),
    [searches.data, productCounts],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="brand__mark" aria-hidden="true">
            $
          </span>
          <div>
            <h1 className="topbar__title">Monitor de precios</h1>
            <p className="topbar__subtitle">
              {lastRun.data
                ? `Actualizado ${formatRelative(lastRun.data.finishedAt)}`
                : 'Sin corridas registradas todavia'}
            </p>
          </div>
        </div>

        <div className="topbar__user">
          <span className="muted small">{user?.email}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void logout()}>
            Salir
          </button>
        </div>
      </header>

      <main className="content">
        {products.error && (
          <div className="alert alert--error" role="alert">
            {products.error}
          </div>
        )}

        <RunStatus run={lastRun.data} />

        <nav className="tabs" aria-label="Busquedas">
          <button
            type="button"
            className={`tab ${filters.searchId === null ? 'tab--active' : ''}`}
            onClick={() => setFilters((prev) => ({ ...prev, searchId: null }))}
          >
            Todas <span className="tab__count">{products.data.length}</span>
          </button>

          {searchTabs.map((search) => (
            <button
              key={search.id}
              type="button"
              className={`tab ${filters.searchId === search.id ? 'tab--active' : ''}`}
              onClick={() => setFilters((prev) => ({ ...prev, searchId: search.id }))}
            >
              {search.label} <span className="tab__count">{search.count}</span>
            </button>
          ))}

          <button
            type="button"
            className="tab tab--action"
            onClick={() => setManaging(true)}
            title="Crear, editar o pausar búsquedas"
          >
            + Búsqueda
          </button>
        </nav>

        <StatsBar stats={stats} />

        <FiltersBar
          filters={filters}
          onFiltersChange={setFilters}
          sortKey={sortKey}
          onSortChange={setSortKey}
          stores={stores}
          resultCount={visible.length}
          totalCount={inSearch.length}
        />

        {products.loading ? (
          <div className="centered centered--inline">
            <div className="spinner" role="status" aria-label="Cargando productos" />
          </div>
        ) : (
          <ProductTable products={visible} sortKey={sortKey} onSelect={setSelected} />
        )}
      </main>

      {selected && <ProductDetail product={selected} onClose={() => setSelected(null)} />}

      {managing && (
        <SearchManager
          searches={searches.data}
          counts={productCounts}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}
