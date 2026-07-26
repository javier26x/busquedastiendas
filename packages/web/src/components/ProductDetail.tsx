import { useEffect, type ReactNode } from 'react';
import type { Product } from '../types.js';
import { usePriceHistory } from '../hooks/useData.js';
import {
  formatDateTime,
  formatDelta,
  formatPercent,
  formatPrice,
  formatRelative,
} from '../lib/format.js';
import { Sparkline } from './Sparkline.js';

export function ProductDetail({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}): ReactNode {
  const history = usePriceHistory(product.key);

  // Cerrar con Escape: el modal atrapa el foco visualmente, conviene una salida
  // de teclado.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={product.title}>
      <button
        type="button"
        className="modal__backdrop"
        onClick={onClose}
        aria-label="Cerrar detalle"
      />

      <div className="modal__panel">
        <header className="modal__header">
          <div>
            <p className="modal__store">{product.storeLabel}</p>
            <h2 className="modal__title">{product.title}</h2>
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>

        <div className="modal__body">
          <div className="detail-grid">
            <Detail label="Precio actual" value={formatPrice(product.price)} strong />
            <Detail
              label="Precio normal"
              value={product.listPrice !== null ? formatPrice(product.listPrice) : '—'}
            />
            <Detail
              label="Descuento"
              value={product.discountPct !== null ? `${product.discountPct}%` : '—'}
            />
            <Detail label="Oferta" value={product.isOffer ? 'Si' : 'No'} />
            <Detail
              label="Variacion"
              value={
                product.priceChangePct !== null
                  ? `${formatPercent(product.priceChangePct)} (${formatDelta(product.priceChange)})`
                  : 'Sin cambios registrados'
              }
            />
            <Detail
              label="Ultimo cambio"
              value={product.priceChangedAt ? formatRelative(product.priceChangedAt) : '—'}
            />
            <Detail label="Precio minimo visto" value={formatPrice(product.minPrice)} />
            <Detail label="Precio maximo visto" value={formatPrice(product.maxPrice)} />
            <Detail label="Primer registro" value={formatDateTime(product.firstSeenAt)} />
            <Detail label="Ultima vez visto" value={formatDateTime(product.lastSeenAt)} />
          </div>

          <section className="modal__section">
            <h3 className="modal__section-title">Historial de precio</h3>
            {history.loading ? (
              <div className="spinner spinner--sm" role="status" aria-label="Cargando historial" />
            ) : history.error ? (
              <p className="muted small">{history.error}</p>
            ) : (
              <Sparkline points={history.data} />
            )}
          </section>

          {history.data.length > 1 && (
            <section className="modal__section">
              <h3 className="modal__section-title">Registros</h3>
              <ul className="history-list">
                {[...history.data].reverse().map((point, index) => (
                  <li key={`${point.capturedAt.getTime()}-${index}`}>
                    <span>{formatDateTime(point.capturedAt)}</span>
                    <span className="history-list__price">
                      {formatPrice(point.price)}
                      {point.isOffer && <span className="badge badge--offer">Oferta</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer className="modal__footer">
          <a
            className="btn btn--primary"
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver en {product.storeLabel} ↗
          </a>
        </footer>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): ReactNode {
  return (
    <div className="detail">
      <span className="detail__label">{label}</span>
      <span className={`detail__value ${strong ? 'detail__value--strong' : ''}`}>{value}</span>
    </div>
  );
}
