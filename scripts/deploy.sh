#!/usr/bin/env bash
#
# Despliegue completo: reglas, indices y panel.
#
#   bash scripts/deploy.sh              despliega todo
#   bash scripts/deploy.sh --scrape     ademas ejecuta una corrida real al final
#   bash scripts/deploy.sh --dry        solo verifica, no despliega nada
#
# El orden importa. Las reglas van antes que el panel: si se sube primero un
# panel que usa permisos que las reglas todavia no otorgan, el usuario ve
# "sin permiso" hasta que termine el resto. Al reves no pasa nada.
#
# Todo el script es idempotente: correrlo dos veces no rompe nada.
#
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_ID="${FIREBASE_PROJECT_ID:-busquedasapp}"
FIREBASE="npx --yes firebase-tools@14"

RUN_SCRAPE=0
DRY=0
for arg in "$@"; do
  case "$arg" in
    --scrape) RUN_SCRAPE=1 ;;
    --dry) DRY=1 ;;
    *) echo "Opcion desconocida: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '    \033[31m✗\033[0m %s\n' "$1"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$1"; }

# ---------------------------------------------------------------------------
say "1. Comprobaciones previas"
# ---------------------------------------------------------------------------
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${node_major}" -lt 20 ]; then
  bad "Node ${node_major}: se necesita 20 o mas"
  exit 1
fi
ok "Node $(node -v)"

if [ -n "$(git status --porcelain)" ]; then
  warn "hay cambios sin confirmar; se despliega el arbol de trabajo tal como esta"
  git status --short | sed 's/^/      /'
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
ok "rama: ${branch}"

# El cron de GitHub Actions corre siempre sobre la rama por defecto. Desplegar
# el panel desde otra rama deja al scraper con codigo viejo y al panel con el
# nuevo, que es la unica combinacion que confunde de verdad.
default_branch="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || true)"
if [ -z "${default_branch}" ]; then
  # El clon no trae anotada la rama por defecto: se le pregunta al remoto,
  # que es la fuente real. Si tampoco responde, mejor callar que avisar mal.
  default_branch="$(git ls-remote --symref origin HEAD 2>/dev/null \
    | sed -n 's|^ref: refs/heads/\([^[:space:]]*\)[[:space:]]*HEAD$|\1|p' || true)"
fi
if [ -n "${default_branch}" ] && [ "${branch}" != "${default_branch}" ]; then
  warn "no estas en ${default_branch}: el cron del scraper seguira usando ${default_branch}"
  warn "para que el scraper tambien se actualice, fusiona antes esta rama"
fi

# ---------------------------------------------------------------------------
say "2. Dependencias"
# ---------------------------------------------------------------------------
npm ci --silent
ok "instaladas"

# ---------------------------------------------------------------------------
say "3. Verificacion (typecheck, tests y pipeline con fixtures)"
# ---------------------------------------------------------------------------
# Solo el scraper: el build del panel (paso 5) ya corre su propio tsc, y
# repetirlo aca duplicaria el typecheck mas lento de los dos.
npm run typecheck --workspace @busquedastiendas/scraper
ok "typecheck"

npm test
ok "tests"

# Recorre el pipeline entero sin salir a internet ni escribir en Firestore.
npm run scrape:fixtures --workspace @busquedastiendas/scraper >/dev/null
ok "pipeline end-to-end"

# ---------------------------------------------------------------------------
say "4. Configuracion del panel"
# ---------------------------------------------------------------------------
# Si ya hay una configuracion valida se usa tal cual: regenerarla en cada
# despliegue pisaria la lista de correos con acceso y ademas exige un gcloud
# autenticado, que no siempre esta (el VPS, por ejemplo). Para forzar la
# regeneracion: bash scripts/write-env.sh
if grep -qE '^VITE_FIREBASE_API_KEY=AIza[A-Za-z0-9_-]{35}$' packages/web/.env.local 2>/dev/null; then
  ok ".env.local existente con una clave de formato valido"
elif command -v gcloud >/dev/null 2>&1 && gcloud auth print-access-token >/dev/null 2>&1; then
  bash scripts/write-env.sh
  ok ".env.local generado desde la API de Firebase"
else
  bad "no hay packages/web/.env.local valido y no hay un gcloud autenticado para generarlo"
  printf '    generalo donde tengas gcloud (Cloud Shell) con: bash scripts/write-env.sh\n'
  printf '    y copia el archivo a este equipo; no se versiona porque el repositorio es publico\n'
  exit 1
fi

# ---------------------------------------------------------------------------
say "5. Construyendo el panel"
# ---------------------------------------------------------------------------
npm run build --workspace @busquedastiendas/web

# Una clave corrupta compila y despliega sin errores: el fallo recien aparece
# en el navegador del usuario. Se corta antes de subirla. El caracter que
# sigue a la clave cierra el formato: sin el, una clave con basura pegada al
# final (AIza validos + resto) pasaria la comprobacion que existe para eso.
if grep -rqE 'AIza[A-Za-z0-9_-]{35}([^A-Za-z0-9_-]|$)' packages/web/dist/assets/*.js; then
  ok "el bundle lleva una clave con formato valido"
else
  bad "el bundle NO lleva una clave valida; no se despliega"
  # `|| true`: si no hay ni rastro de "AIza", el grep del diagnostico saldria
  # con 1 y set -e cortaria el script antes de imprimir este mensaje.
  { grep -rhoE 'AIza.{0,45}' packages/web/dist/assets/*.js | head -1 \
      | sed 's/^/      esto quedo en su lugar: /'; } || printf '      no quedo ni el prefijo AIza: la clave estaba vacia\n'
  exit 1
fi

if [ "${DRY}" = "1" ]; then
  say "Modo --dry: verificado todo, no se desplego nada"
  exit 0
fi

# ---------------------------------------------------------------------------
say "6. Desplegando reglas e indices de Firestore"
# ---------------------------------------------------------------------------
# Primero las reglas: el panel nuevo necesita poder desligar productos al
# borrar una busqueda, y ese permiso vive aca.
${FIREBASE} deploy \
  --only firestore:rules,firestore:indexes \
  --project "${PROJECT_ID}" \
  --non-interactive
ok "reglas e indices"

# ---------------------------------------------------------------------------
say "7. Desplegando el panel"
# ---------------------------------------------------------------------------
${FIREBASE} deploy --only hosting --project "${PROJECT_ID}" --non-interactive
ok "panel"

# ---------------------------------------------------------------------------
say "8. Comprobando el resultado"
# ---------------------------------------------------------------------------
bash scripts/check-auth.sh || warn "la comprobacion reporto problemas; revisa la salida de arriba"

# ---------------------------------------------------------------------------
if [ "${RUN_SCRAPE}" = "1" ]; then
  say "9. Corrida real del scraper"
  # El mismo criterio que usa el scraper (firestore/client.ts): variable,
  # secret, archivo de `gcloud auth application-default login`, o el servidor
  # de metadatos de Cloud Shell/GCE. Rechazar aca lo que el scraper acepta
  # cortaria despues de haber desplegado todo.
  if [ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ] \
    && [ -z "${FIREBASE_SERVICE_ACCOUNT:-}" ] \
    && [ -z "${GOOGLE_CLOUD_PROJECT:-}" ] && [ -z "${GCE_METADATA_HOST:-}" ] \
    && [ ! -f "${HOME}/.config/gcloud/application_default_credentials.json" ]; then
    bad "faltan credenciales para escribir en Firestore. Cualquiera de estas sirve:"
    printf '      export GOOGLE_APPLICATION_CREDENTIALS=~/ruta/al/service-account.json   (ruta al archivo)\n'
    printf "      export FIREBASE_SERVICE_ACCOUNT=\"\$(cat ~/ruta/al/service-account.json)\"   (el JSON completo)\n"
    printf '      gcloud auth application-default login\n'
    exit 1
  fi
  npm run scrape
fi

# ---------------------------------------------------------------------------
say "Listo"
# ---------------------------------------------------------------------------
printf '    Panel:   https://%s.web.app\n' "${PROJECT_ID}"
printf '    Consola: https://console.firebase.google.com/project/%s/firestore\n\n' "${PROJECT_ID}"

if [ "${RUN_SCRAPE}" != "1" ]; then
  printf '    Falta la primera corrida con las tiendas nuevas:\n'
  printf '      npm run scrape -- --dry-run     ver que tienda responde, sin escribir\n'
  printf '      npm run scrape                  corrida real\n\n'
fi
