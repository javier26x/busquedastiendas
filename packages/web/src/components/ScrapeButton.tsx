import { type ReactNode } from 'react';
import { useScrapeTrigger } from '../hooks/useScrapeTrigger.js';

/**
 * Boton para lanzar una corrida del scraper sin esperar al cron.
 *
 * Muestra el avance: mientras corre queda deshabilitado con un enlace a la
 * ejecucion en GitHub. Cuando termina, los datos ya se actualizaron solos por
 * los listeners de Firestore; aca solo se confirma.
 */
export function ScrapeButton(): ReactNode {
  const { state, busy, run, reset } = useScrapeTrigger();

  return (
    <div className="scrape">
      <button
        type="button"
        className="btn btn--primary btn--sm"
        onClick={() => void run()}
        disabled={busy}
        title="Consulta las tiendas ahora, sin esperar la corrida programada"
      >
        {busy ? (
          <>
            <span className="spinner spinner--inline" aria-hidden="true" />
            {state.kind === 'dispatching' ? 'Lanzando…' : 'Actualizando…'}
          </>
        ) : (
          '↻ Actualizar ahora'
        )}
      </button>

      {state.kind === 'running' && state.url && (
        <a className="muted small scrape__link" href={state.url} target="_blank" rel="noreferrer">
          ver en GitHub
        </a>
      )}

      {state.kind === 'done' && (
        <span className="muted small scrape__note">
          Listo{' '}
          {state.url && (
            <a href={state.url} target="_blank" rel="noreferrer">
              (ver corrida)
            </a>
          )}
        </span>
      )}

      {state.kind === 'error' && (
        <span className="scrape__error small" role="alert">
          {state.message}
          {state.needsSetup && (
            <>
              {' '}
              <a
                href="https://github.com/javier26x/busquedastiendas/blob/main/SETUP.md#actualizar-ahora"
                target="_blank"
                rel="noreferrer"
              >
                cómo activarlo
              </a>
            </>
          )}{' '}
          <button type="button" className="linkish" onClick={reset}>
            cerrar
          </button>
        </span>
      )}
    </div>
  );
}
