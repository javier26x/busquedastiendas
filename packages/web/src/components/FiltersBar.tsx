import type { ReactNode } from 'react';
import { DEFAULT_FILTERS, SORT_OPTIONS, type Filters, type SortKey } from '../lib/sort.js';
import type { Product } from '../types.js';
import { csvFilename, downloadCsv, toCsv } from '../lib/csv.js';

interface Props {
  filters: Filters;
  onFiltersChange: (updater: (prev: Filters) => Filters) => void;
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
  stores: { id: string; label: string; count: number }[];
  resultCount: number;
  totalCount: number;
  /** Lo que la tabla esta mostrando, para poder exportarlo tal cual. */
  visible: Product[];
  /** Nombre de la busqueda activa; solo se usa para el nombre del archivo. */
  searchLabel: string | null;
}

export function FiltersBar({
  filters,
  onFiltersChange,
  sortKey,
  onSortChange,
  stores,
  resultCount,
  totalCount,
  visible,
  searchLabel,
}: Props): ReactNode {
  const activeSort = SORT_OPTIONS.find((option) => option.key === sortKey);

  const toggleStore = (storeId: string): void => {
    onFiltersChange((prev) => ({
      ...prev,
      storeIds: prev.storeIds.includes(storeId)
        ? prev.storeIds.filter((id) => id !== storeId)
        : [...prev.storeIds, storeId],
    }));
  };

  const hasActiveFilters =
    filters.storeIds.length > 0 ||
    filters.onlyOffers ||
    filters.onlyDrops ||
    filters.onlyHistoricLows ||
    filters.onlyAvailable ||
    filters.query.trim() !== '';

  return (
    <section className="filters" aria-label="Filtros y orden">
      <div className="filters__row">
        <div className="field field--grow">
          <label className="field__label" htmlFor="buscar">
            Buscar
          </label>
          <input
            id="buscar"
            type="search"
            className="input"
            placeholder="Filtrar por titulo, marca o tienda"
            value={filters.query}
            onChange={(event) =>
              onFiltersChange((prev) => ({ ...prev, query: event.target.value }))
            }
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="orden">
            Ordenar por
          </label>
          <select
            id="orden"
            className="input"
            value={sortKey}
            onChange={(event) => onSortChange(event.target.value as SortKey)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          {activeSort && <span className="field__hint">{activeSort.hint}</span>}
        </div>
      </div>

      <div className="filters__row filters__row--wrap">
        <div className="chips" role="group" aria-label="Tiendas">
          {stores.map((store) => (
            <button
              key={store.id}
              type="button"
              className={`chip ${filters.storeIds.includes(store.id) ? 'chip--active' : ''}`}
              onClick={() => toggleStore(store.id)}
              aria-pressed={filters.storeIds.includes(store.id)}
            >
              {store.label} <span className="chip__count">{store.count}</span>
            </button>
          ))}
        </div>

        <div className="toggles">
          <Toggle
            label="Solo ofertas"
            checked={filters.onlyOffers}
            onChange={(checked) => onFiltersChange((prev) => ({ ...prev, onlyOffers: checked }))}
          />
          <Toggle
            label="Solo bajadas"
            checked={filters.onlyDrops}
            onChange={(checked) => onFiltersChange((prev) => ({ ...prev, onlyDrops: checked }))}
          />
          <Toggle
            label="Solo en su minimo"
            checked={filters.onlyHistoricLows}
            onChange={(checked) =>
              onFiltersChange((prev) => ({ ...prev, onlyHistoricLows: checked }))
            }
          />
          <Toggle
            label="Solo disponibles"
            checked={filters.onlyAvailable}
            onChange={(checked) => onFiltersChange((prev) => ({ ...prev, onlyAvailable: checked }))}
          />
        </div>
      </div>

      <div className="filters__footer">
        <span className="muted small">
          Mostrando <strong>{resultCount}</strong> de {totalCount} productos
        </span>
        <div className="filters__actions">
          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() =>
                onFiltersChange((prev) => ({ ...DEFAULT_FILTERS, searchId: prev.searchId }))
              }
            >
              Limpiar filtros
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={visible.length === 0}
            title="Descarga lo que se esta mostrando, con sus filtros y su orden"
            onClick={() => downloadCsv(toCsv(visible), csvFilename(searchLabel))}
          >
            Exportar CSV
          </button>
        </div>
      </div>
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): ReactNode {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
