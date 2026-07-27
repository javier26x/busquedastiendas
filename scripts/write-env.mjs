/**
 * Genera packages/web/.env.local leyendo la configuracion real desde la API
 * de administracion de Firebase.
 *
 * Evita copiar y pegar credenciales a mano, que es donde se cuelan errores
 * silenciosos: una clave truncada produce un build que compila y despliega
 * bien, pero falla en el navegador con auth/api-key-not-valid.
 *
 * Se invoca desde scripts/write-env.sh, que aporta el token de gcloud.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TOKEN = process.env['GOOGLE_ACCESS_TOKEN'];
const PROJECT_ID = process.env['FIREBASE_PROJECT_ID'];
const ALLOWED_EMAILS = process.env['ALLOWED_EMAILS'] ?? 'javier.neo@gmail.com';
const OUT = resolve(process.cwd(), 'packages/web/.env.local');

const API = 'https://firebase.googleapis.com/v1beta1';

if (!TOKEN || !PROJECT_ID) {
  console.error('Faltan GOOGLE_ACCESS_TOKEN o FIREBASE_PROJECT_ID.');
  console.error('Usa scripts/write-env.sh, que los define por ti.');
  process.exit(1);
}

async function api(path) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en ${path}: ${body.slice(0, 300)}`);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Respuesta no-JSON en ${path}: ${body.slice(0, 200)}`);
  }
}

/** Enmascara para poder mostrar por pantalla sin exponer el valor completo. */
function mask(value) {
  if (!value) return '(vacio)';
  return value.length <= 12 ? '***' : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

async function main() {
const { apps = [] } = await api(`/projects/${PROJECT_ID}/webApps`);

if (apps.length === 0) {
  console.error(`El proyecto ${PROJECT_ID} no tiene ninguna app web registrada.`);
  console.error(
    `Crea una en https://console.firebase.google.com/project/${PROJECT_ID}/settings/general`,
  );
  process.exit(1);
}

if (apps.length > 1) {
  console.log(`Hay ${apps.length} apps web; se usa la primera: ${apps[0].displayName ?? apps[0].appId}`);
}

const config = await api(`/projects/${PROJECT_ID}/webApps/${apps[0].appId}/config`);

const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
const missing = required.filter((key) => !config[key]);
if (missing.length > 0) {
  throw new Error(`La configuracion vino incompleta, faltan: ${missing.join(', ')}`);
}

const lines = [
  '# Generado por scripts/write-env.sh desde la API de Firebase.',
  '# No se versiona: el repositorio es publico.',
  '',
  `VITE_FIREBASE_API_KEY=${config.apiKey}`,
  `VITE_FIREBASE_AUTH_DOMAIN=${config.authDomain}`,
  `VITE_FIREBASE_PROJECT_ID=${config.projectId}`,
  `VITE_FIREBASE_STORAGE_BUCKET=${config.storageBucket ?? ''}`,
  `VITE_FIREBASE_MESSAGING_SENDER_ID=${config.messagingSenderId ?? ''}`,
  `VITE_FIREBASE_APP_ID=${config.appId}`,
  '',
  `VITE_ALLOWED_EMAILS=${ALLOWED_EMAILS}`,
  '',
];

await writeFile(OUT, lines.join('\n'), 'utf8');

console.log(`Escrito ${OUT}`);
console.log(`  apiKey           ${mask(config.apiKey)}   (${config.apiKey.length} caracteres)`);
console.log(`  authDomain       ${config.authDomain}`);
console.log(`  projectId        ${config.projectId}`);
console.log(`  appId            ${mask(config.appId)}`);
console.log(`  correos con acceso  ${ALLOWED_EMAILS}`);

// Una clave de Google valida empieza por AIza y tiene 39 caracteres. Avisamos
// aca porque el sintoma natural aparece recien en el navegador.
if (!/^AIza[\w-]{35}$/.test(config.apiKey)) {
  console.warn('\n! La apiKey no tiene el formato esperado (AIza + 35 caracteres).');
  process.exitCode = 1;
}
}

main().catch((error) => {
  console.error(`\nNo se pudo generar .env.local:\n  ${error.message}\n`);
  if (String(error.message).includes('HTTP 401') || String(error.message).includes('HTTP 403')) {
    console.error('Revisa que gcloud este autenticado como el dueno del proyecto:');
    console.error('  gcloud auth login');
  }
  process.exit(1);
});
