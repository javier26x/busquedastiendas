import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth, googleProvider, isEmailAllowed } from './firebase.js';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  /** El correo esta en la lista blanca (ademas de lo que exigen las reglas). */
  allowed: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      getFirebaseAuth(),
      (nextUser) => {
        setUser(nextUser);
        setLoading(false);
      },
      (authError) => {
        setError(describeAuthError(authError));
        setLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    const auth = getFirebaseAuth();

    try {
      await signInWithPopup(auth, googleProvider);
    } catch (popupError) {
      const code = (popupError as { code?: string }).code ?? '';

      // Si el navegador bloquea la ventana emergente, seguimos por redireccion.
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(auth, googleProvider);
        return;
      }

      // Cerrar la ventana a proposito no es un error que valga la pena mostrar.
      if (code === 'auth/cancelled-popup-request' || code === 'auth/popup-closed-by-user') {
        return;
      }

      setError(describeAuthError(popupError));
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(getFirebaseAuth());
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      error,
      allowed: isEmailAllowed(user?.email),
      signIn,
      logout,
      clearError,
    }),
    [user, loading, error, signIn, logout, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return context;
}

/** Traduce los codigos de Firebase a algo accionable. */
function describeAuthError(error: unknown): string {
  const code = (error as { code?: string }).code ?? '';

  switch (code) {
    case 'auth/unauthorized-domain':
      return 'Este dominio no esta autorizado en Firebase Authentication. Agregalo en Authentication > Settings > Authorized domains.';
    case 'auth/network-request-failed':
      return 'No se pudo conectar con Firebase. Revisa tu conexion.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera un momento y vuelve a probar.';
    case 'auth/configuration-not-found':
      return 'Falta habilitar el proveedor Google en Firebase Authentication.';
    default:
      return error instanceof Error ? error.message : 'No se pudo iniciar sesion.';
  }
}
