import type { ReactNode } from 'react';
import { useAuth } from '../auth.js';

export function LoginScreen(): ReactNode {
  const { signIn, error, clearError } = useAuth();

  return (
    <div className="centered">
      <div className="card card--narrow">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            $
          </span>
          <div>
            <h1 className="card__title">Monitor de precios</h1>
            <p className="muted small">Bodegas de jardin y cajas organizadoras · Chile</p>
          </div>
        </div>

        <p className="muted">
          Panel privado. Entra con la cuenta de Google autorizada para ver las busquedas y sus
          resultados.
        </p>

        {error && (
          <div className="alert alert--error" role="alert">
            <span>{error}</span>
            <button type="button" className="alert__close" onClick={clearError} aria-label="Cerrar">
              ×
            </button>
          </div>
        )}

        <button type="button" className="btn btn--primary btn--block" onClick={() => void signIn()}>
          <GoogleMark />
          Entrar con Google
        </button>
      </div>
    </div>
  );
}

function GoogleMark(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
