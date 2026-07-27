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
      //
      // Se valida antes de seguir: applicationDefault() no falla al construirse
      // sino al primer uso, y para entonces el error que aparece es
      // "Unable to detect a Project Id", que no dice nada del problema real.
      const projectId =
        process.env['GOOGLE_CLOUD_PROJECT'] ??
        process.env['GCLOUD_PROJECT'] ??
        process.env['FIREBASE_PROJECT_ID'];

      if (!projectId && !process.env['GOOGLE_APPLICATION_CREDENTIALS']) {
        throw new Error(
          'Faltan credenciales de Firebase. Opciones:\n' +
            '  - definir FIREBASE_SERVICE_ACCOUNT con el JSON de la cuenta de servicio\n' +
            '    (en GitHub Actions: Settings > Secrets and variables > Actions)\n' +
            '  - apuntar GOOGLE_APPLICATION_CREDENTIALS al archivo de la clave\n' +
            '  - ejecutar `gcloud auth application-default login`\n' +
            'Para probar sin escribir en Firestore, usa --dry-run.',
        );
      }

      initializeApp({ credential: applicationDefault(), projectId });
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
