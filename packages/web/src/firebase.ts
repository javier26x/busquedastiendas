import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

/**
 * Configuracion de Firebase.
 *
 * Se toma de variables `VITE_*` (archivo `.env.local` en desarrollo, secrets
 * del workflow en el despliegue). Estos valores no son secretos: la seguridad
 * real la dan las reglas de Firestore y la lista de correos autorizados.
 */
const firebaseConfig = {
  apiKey: import.meta.env['VITE_FIREBASE_API_KEY'],
  authDomain: import.meta.env['VITE_FIREBASE_AUTH_DOMAIN'],
  projectId: import.meta.env['VITE_FIREBASE_PROJECT_ID'],
  storageBucket: import.meta.env['VITE_FIREBASE_STORAGE_BUCKET'],
  messagingSenderId: import.meta.env['VITE_FIREBASE_MESSAGING_SENDER_ID'],
  appId: import.meta.env['VITE_FIREBASE_APP_ID'],
};

/** Campos sin los cuales la app no puede arrancar. */
const REQUIRED: (keyof typeof firebaseConfig)[] = ['apiKey', 'authDomain', 'projectId', 'appId'];

export const missingConfig = REQUIRED.filter((key) => !firebaseConfig[key]);
export const isConfigured = missingConfig.length === 0;

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

function ensureApp(): FirebaseApp {
  if (!isConfigured) {
    throw new Error(
      `Falta configuracion de Firebase: ${missingConfig.map((k) => `VITE_FIREBASE_${camelToEnv(k)}`).join(', ')}`,
    );
  }
  app ??= initializeApp(firebaseConfig);
  return app;
}

export function getFirebaseAuth(): Auth {
  authInstance ??= getAuth(ensureApp());
  return authInstance;
}

export function getDb(): Firestore {
  dbInstance ??= getFirestore(ensureApp());
  return dbInstance;
}

export const googleProvider = new GoogleAuthProvider();
// Fuerza el selector de cuenta: evita entrar con una sesion de Google distinta
// a la autorizada sin darse cuenta.
googleProvider.setCustomParameters({ prompt: 'select_account' });

function camelToEnv(key: string): string {
  return key.replace(/([A-Z])/g, '_$1').toUpperCase();
}

/**
 * Correos con acceso al panel.
 *
 * Es solo para dar un mensaje claro en la UI; el control real esta en
 * `firestore.rules`, que es lo que un usuario no puede saltarse.
 */
const DEFAULT_ALLOWED = 'javier.neo@gmail.com';

export const ALLOWED_EMAILS: string[] = String(
  // `||` y no `??`: un secret definido pero vacio dejaria la lista vacia y
  // nadie podria entrar.
  import.meta.env['VITE_ALLOWED_EMAILS'] || DEFAULT_ALLOWED,
)
  .split(',')
  .map((email: string) => email.trim().toLowerCase())
  .filter(Boolean);

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return ALLOWED_EMAILS.includes(email.toLowerCase());
}
