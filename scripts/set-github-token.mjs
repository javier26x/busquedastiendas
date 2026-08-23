/**
 * Guarda en Firestore el token con el que el boton "Actualizar ahora" dispara
 * el workflow del scraper.
 *
 * Va a Firestore y no a un archivo del sitio a proposito: el bundle es
 * publico, y las reglas solo dejan leer este documento al correo autorizado.
 * Se escribe con las credenciales del dueno (token de gcloud), que se saltan
 * las reglas igual que el Admin SDK.
 *
 * Se invoca desde scripts/set-github-token.sh, que aporta el token de gcloud.
 */

const ACCESS_TOKEN = process.env['GOOGLE_ACCESS_TOKEN'];
const PROJECT_ID = process.env['FIREBASE_PROJECT_ID'];
const GITHUB_TOKEN = process.env['GITHUB_TOKEN'];
const OWNER = process.env['GH_OWNER'] ?? 'javier26x';
const REPO = process.env['GH_REPO'] ?? 'busquedastiendas';
const WORKFLOW = process.env['GH_WORKFLOW'] ?? 'scrape.yml';
const REF = process.env['GH_REF'] ?? 'main';

if (!ACCESS_TOKEN || !PROJECT_ID || !GITHUB_TOKEN) {
  console.error('Faltan GOOGLE_ACCESS_TOKEN, FIREBASE_PROJECT_ID o GITHUB_TOKEN.');
  console.error('Usa scripts/set-github-token.sh, que te los pide y define.');
  process.exit(1);
}

const DOC =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
  `/databases/(default)/documents/config/github`;

/** Firestore REST exige envolver cada valor con su tipo. */
const body = {
  fields: {
    token: { stringValue: GITHUB_TOKEN },
    owner: { stringValue: OWNER },
    repo: { stringValue: REPO },
    workflow: { stringValue: WORKFLOW },
    ref: { stringValue: REF },
  },
};

async function main() {
  const response = await fetch(DOC, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      // Las credenciales por defecto no traen proyecto de cuota; sin esto la
      // API responde 403.
      'x-goog-user-project': PROJECT_ID,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  console.log('Token guardado en config/github.');
  console.log(`  owner/repo   ${OWNER}/${REPO}`);
  console.log(`  workflow     ${WORKFLOW} @ ${REF}`);
  console.log('  token        ' + mask(GITHUB_TOKEN));
  console.log('\nEl boton "Actualizar ahora" del panel ya puede disparar la corrida.');
}

function mask(value) {
  return value.length <= 12 ? '***' : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

main().catch((error) => {
  console.error(`\nNo se pudo guardar el token:\n  ${error.message}\n`);
  const text = String(error.message);
  if (text.includes('quota project')) {
    console.error(`  gcloud auth application-default set-quota-project ${PROJECT_ID}`);
  } else if (text.includes('HTTP 401') || text.includes('HTTP 403')) {
    console.error('  Revisa que gcloud este autenticado como el dueno del proyecto: gcloud auth login');
  }
  process.exit(1);
});
