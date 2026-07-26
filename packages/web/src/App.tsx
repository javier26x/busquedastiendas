import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth.js';
import { isConfigured, missingConfig } from './firebase.js';
import { LoginScreen } from './components/LoginScreen.js';
import { Dashboard } from './components/Dashboard.js';

export function App(): ReactNode {
  // Sin credenciales de Firebase no tiene sentido montar el proveedor de auth:
  // cualquier llamada lanzaria una excepcion poco util.
  if (!isConfigured) return <ConfigMissing />;

  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate(): ReactNode {
  const { user, loading, allowed, logout } = useAuth();

  if (loading) {
    return (
      <div className="centered">
        <div className="spinner" role="status" aria-label="Cargando" />
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  if (!allowed) {
    return (
      <div className="centered">
        <div className="card card--narrow">
          <h1 className="card__title">Sin acceso</h1>
          <p className="muted">
            La cuenta <strong>{user.email}</strong> no esta autorizada para ver este panel.
          </p>
          <p className="muted small">
            Si es tu cuenta, agregala a <code>VITE_ALLOWED_EMAILS</code> y a{' '}
            <code>firestore.rules</code>.
          </p>
          <button type="button" className="btn btn--ghost" onClick={() => void logout()}>
            Cerrar sesion
          </button>
        </div>
      </div>
    );
  }

  return <Dashboard />;
}

function ConfigMissing(): ReactNode {
  return (
    <div className="centered">
      <div className="card card--narrow">
        <h1 className="card__title">Falta configurar Firebase</h1>
        <p className="muted">
          No estan definidas estas variables de entorno:
        </p>
        <ul className="config-list">
          {missingConfig.map((key) => (
            <li key={key}>
              <code>VITE_FIREBASE_{key.replace(/([A-Z])/g, '_$1').toUpperCase()}</code>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Copia <code>.env.example</code> a <code>.env.local</code> y completa los valores desde
          la consola de Firebase (Configuracion del proyecto &gt; Tus apps). El paso a paso esta
          en <code>SETUP.md</code>.
        </p>
      </div>
    </div>
  );
}
