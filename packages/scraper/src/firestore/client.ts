import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Inicializa firebase-admin.
 *
 * Credenciales, en orden de preferencia:
 *   1. `FIREBASE_SERVICE_ACCOUNT` con el JSON de la cuenta de servicio
 *      (texto plano o base64). Es lo que usa el workflow de GitHub Actions.
 *   2. Credenciales por defecto del entorno: `GOOGLE_APPLICATION_CREDENTIALS`,
 *      `gcloud auth application-default login`, o Cloud Shell / GCE, donde ya
 *      estan disponibles sin configurar nada.
 */
let cached: Firestore | null = null;

export function getDb(): Firestore {
  if (cached) return cached;

  if (getApps().length === 0) {
    const raw = process.env['FIREBASE_SERVICE_ACCOUNT']?.trim();

    if (raw) {
      const serviceAccount = parseServiceAccount(raw);
      initializeApp({
        credential: cert({
          projectId: serviceAccount.project_id,
          clientEmail: serviceAccount.client_email,
          privateKey: serviceAccount.private_key,
        }),
        projectId: serviceAccount.project_id,
      });
    } else {
      // Credenciales por defecto del entorno: cubre GOOGLE_APPLICATION_CREDENTIALS,
      // `gcloud auth application-default login` y Cloud Shell / GCE, donde ya
      // vienen disponibles sin configurar nada.
      try {
        initializeApp({
          credential: applicationDefault(),
          projectId:
            process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'] ?? undefined,
        });
      } catch {
        throw new Error(
          'Faltan credenciales de Firebase. Opciones: definir FIREBASE_SERVICE_ACCOUNT ' +
            '(JSON o base64), apuntar GOOGLE_APPLICATION_CREDENTIALS a la clave, o ejecutar ' +
            '`gcloud auth application-default login`. Para probar sin Firebase usa --dry-run.',
        );
      }
    }
  }

  cached = getFirestore();
  cached.settings({ ignoreUndefinedProperties: true });
  return cached;
}

interface ServiceAccountJson {
  project_id: string;
  client_email: string;
  private_key: string;
}

function parseServiceAccount(raw: string): ServiceAccountJson {
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT no es JSON valido (ni base64 de un JSON valido).',
    );
  }

  const account = parsed as Partial<ServiceAccountJson>;
  if (!account.project_id || !account.client_email || !account.private_key) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT incompleto: faltan project_id, client_email o private_key.',
    );
  }

  return {
    project_id: account.project_id,
    client_email: account.client_email,
    // GitHub Secrets suele escapar los saltos de linea de la clave.
    private_key: account.private_key.replace(/\\n/g, '\n'),
  };
}
