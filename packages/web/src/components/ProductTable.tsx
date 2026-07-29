import type { ReactNode } from 'react';
import type { Product } from '../types.js';
import type { SortKey } from '../lib/sort.js';
import {
  formatDelta,
  formatPercent,
  formatPrice,
  formatRelative,
  isStale,
} from '../lib/format.js';

interface Props {
  products: Product[];
  sortKey: SortKey;
  onSelect: (product: Product) => void;
  /** Explicacion a mostrar cuando no hay nada que listar. */
  emptyHint?: ReactNode;
}

/** Que columna resaltar segun el orden elegido. */
function highlightedColumn(sortKey: SortKey): 'precio' | 'variacion' | 'oferta' | null {
  if (sortKey === 'precio-asc' || sortKey === 'precio-desc') return 'precio';
  if (sortKey === 'variacion-baja' || sortKey === 'variacion-alza') return 'variacion';
  if (sortKey === 'oferta' || sortKey === 'descuento-desc') return 'oferta';
  return null;
}

export function ProductTable({ products, sortKey, onSelect, emptyHint }: Props): ReactNode {
  const highlight = highlightedColumn(sortKey);

  if (products.length === 0) {
    return (
      <div className="empty">
        {emptyHint ?? (
          <>
            <p className="empty__title">Sin resultados</p>
            <p className="muted small">
              Ajusta los filtros, o corre el scraper si todavía no hay datos cargados.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Producto</th>
            <th scope="col">Tienda</th>
            <th scope="col" className={highlight === 'precio' ? 'is-sorted' : ''}>
              Precio
            </th>
            <th scope="col" className={highlight === 'variacion' ? 'is-sorted' : ''}>
              Variacion
            </th>
            <th scope="col" className={highlight === 'oferta' ? 'is-sorted' : ''}>
              Oferta
            </th>
            <th scope="col">Visto</th>
            <th scope="col">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {products.map((product) => (
            <Row key={product.key} product={product} onSelect={onSelect} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  product,
  onSelect,
}: {
  product: Product;
  onSelect: (product: Product) => void;
}): ReactNode {
  const stale = isStale(product.lastSeenAt);

  return (
    <tr
      className={`row ${stale ? 'row--stale' : ''}`}
      onClick={() => onSelect(product)}
      tabIndex={0}
      role="button"
      aria-label={`Ver historial de ${product.title}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(product);
        }
      }}
    >
      <td data-label="Producto">
        <div className="product">
          {product.image ? (
            <img className="product__img" src={product.image} alt="" loading="lazy" />
          ) : (
            <div className="product__img product__img--empty" aria-hidden="true" />
          )}
          <div className="product__text">
            <span className="product__title">{product.title}</span>
            <span className="product__meta">
              {product.brand && <span>{product.brand}</span>}
              {!product.available && <span className="badge badge--muted">Sin stock</span>}
            </span>
          </div>
        </div>
      </td>

      <td data-label="Tienda">
        <span className="store">{product.storeLabel}</span>
      </td>

      <td data-label="Precio">
        <div className="price">
          <span className="price__current">{formatPrice(product.price)}</span>
          {product.listPrice !== null && (
            <span className="price__list">{formatPrice(product.listPrice)}</span>
          )}
        </div>
      </td>

      <td data-label="Variacion">
        <Variation product={product} />
      </td>

      <td data-label="Oferta">
        {product.isOffer ? (
          <span className="badge badge--offer">
            Oferta{product.discountPct !== null ? ` −${product.discountPct}%` : ''}
          </span>
        ) : (
          <span className="muted small">No</span>
        )}
      </td>

      <td data-label="Visto">
        <span className="muted small">{formatRelative(product.lastSeenAt)}</span>
      </td>

      <td data-label="">
        <a
          className="btn btn--ghost btn--sm"
          href={product.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          Ver ↗
        </a>
      </td>
    </tr>
  );
}

function Variation({ product }: { product: Product }): ReactNode {
  if (product.priceChange === null || product.priceChangePct === null) {
    return <span className="muted small">Sin cambios</span>;
  }

  const down = product.priceChange < 0;

  return (
    <div className={`variation ${down ? 'variation--down' : 'variation--up'}`}>
      <span className="variation__pct">
        {down ? '▼' : '▲'} {formatPercent(product.priceChangePct)}
      </span>
      <span className="variation__delta">
        {formatDelta(product.priceChange)} · desde {formatPrice(product.previousPrice)}
      </span>
    </div>
  );
}
