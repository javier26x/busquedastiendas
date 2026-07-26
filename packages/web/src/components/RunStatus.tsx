import { useState, type ReactNode } from 'react';
import type { RunDoc } from '../types.js';
import { formatDateTime } from '../lib/format.js';

/**
 * Estado de la ultima corrida del scraper.
 *
 * Es importante mostrarlo: si una tienda cambia su sitio y su adaptador deja
 * de traer datos, el panel seguiria viendose "normal" pero con precios
 * congelados. Aca queda visible que tienda fallo.
 */
export function RunStatus({ run }: { run: RunDoc | null }): ReactNode {
  const [open, setOpen] = useState(false);

  if (!run) {
    return (
      <div className="alert alert--info">
        Todavia no hay corridas registradas. Ejecuta <code>npm run scrape</code> o espera al
        proximo cron de GitHub Actions.
      </div>
    );
  }

  const failed = run.stores.filter((store) => !store.ok);

  return (
    <div className={`runbar runbar--${run.status}`}>
      <div className="runbar__main">
        <span className={`dot dot--${run.status}`} aria-hidden="true" />
        <span className="runbar__text">
          {run.status === 'ok' && 'Todas las tiendas respondieron'}
          {run.status === 'partial' && `${failed.length} tienda(s) no respondieron`}
          {run.status === 'error' && 'Ninguna tienda respondio'}
        </span>
        <span className="muted small">{formatDateTime(run.finishedAt)}</span>
        <span className="muted small">
          {run.totals.priceChanges} cambio(s) de precio · {run.totals.drops} baja(s) ·{' '}
          {run.totals.rises} alza(s)
        </span>
      </div>

      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {open ? 'Ocultar detalle' : 'Ver detalle'}
      </button>

      {open && (
        <ul className="runbar__stores">
          {run.stores.map((store) => (
            <li key={store.storeId} className={store.ok ? '' : 'is-failed'}>
              <span className={`dot dot--${store.ok ? 'ok' : 'error'}`} aria-hidden="true" />
              <strong>{store.storeLabel}</strong>
              <span className="muted small">
                {store.ok ? `${store.kept} relevantes de ${store.found}` : (store.error ?? 'fallo')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
