import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
      // `.firebaserc` manda sobre el entorno: en Cloud Shell el proyecto
      // activo puede ser otro, y escribir en la base equivocada es peor que
      // fallar. Las variables solo sirven de respaldo.
      const projectId =
        readProjectFromFirebaserc() ??
        process.env['FIREBASE_PROJECT_ID'] ??
        process.env['GOOGLE_CLOUD_PROJECT'] ??
        process.env['GCLOUD_PROJECT'];

      // Se comprueba que haya credenciales, no que haya proyecto: son cosas
      // distintas y confundirlas deja pasar el control para reventar despues,
      // dentro del SDK y fuera de cualquier try/catch util.
      if (!hasDefaultCredentials()) {
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

/**
 * Detecta si el entorno puede proveer credenciales por defecto.
 *
 * Cubre las tres formas reales: una clave apuntada por variable, el archivo
 * que deja `gcloud auth application-default login`, y el servidor de
 * metadatos de Cloud Shell / GCE.
 */
function hasDefaultCredentials(): boolean {
  if (process.env['GOOGLE_APPLICATION_CREDENTIALS']) return true;

  // Presente en Cloud Shell, Cloud Run, GCE y GitHub Actions con auth de Google.
  if (process.env['GOOGLE_CLOUD_PROJECT'] || process.env['GCE_METADATA_HOST']) return true;

  const home = process.env['HOME'] ?? process.env['USERPROFILE'];
  if (!home) return false;

  return existsSync(`${home}/.config/gcloud/application_default_credentials.json`);
}

/**
 * Lee el proyecto declarado en `.firebaserc`, en la raiz del repositorio.
 *
 * Es la fuente mas confiable: viaja con el codigo y no depende de que
 * variable de entorno quedo definida en la sesion.
 */
function readProjectFromFirebaserc(): string | undefined {
  try {
    const path = fileURLToPath(new URL('../../../../.firebaserc', import.meta.url));
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      projects?: Record<string, string>;
    };
    return parsed.projects?.['default'];
  } catch {
    // No existe o no es legible: se usan las variables de entorno.
    return undefined;
  }
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
