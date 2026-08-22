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
default_branch="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || echo main)"
if [ "${branch}" != "${default_branch}" ]; then
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
npm run typecheck
ok "typecheck"

npm test
ok "tests"

# Recorre el pipeline entero sin salir a internet ni escribir en Firestore.
npm run scrape -- --stores=fixture --dry-run >/dev/null
ok "pipeline end-to-end"

# ---------------------------------------------------------------------------
say "4. Configuracion del panel"
# ---------------------------------------------------------------------------
if command -v gcloud >/dev/null 2>&1; then
  bash scripts/write-env.sh
  ok ".env.local regenerado desde la API de Firebase"
elif grep -qE 'VITE_FIREBASE_API_KEY=AIza[A-Za-z0-9_-]{35}' packages/web/.env.local 2>/dev/null; then
  # Sin gcloud no se puede regenerar, pero si ya hay una clave con la forma
  # correcta no hay razon para bloquear el despliegue.
  ok ".env.local existente con una clave de formato valido"
else
  bad "falta packages/web/.env.local y no hay gcloud para generarlo"
  printf '    generalo en Cloud Shell con: bash scripts/write-env.sh\n'
  exit 1
fi

# ---------------------------------------------------------------------------
say "5. Construyendo el panel"
# ---------------------------------------------------------------------------
npm run build --workspace @busquedastiendas/web

# Una clave corrupta compila y despliega sin errores: el fallo recien aparece
# en el navegador del usuario. Se corta antes de subirla.
if grep -rqE 'AIza[A-Za-z0-9_-]{35}' packages/web/dist/assets/*.js; then
  ok "el bundle lleva una clave con formato valido"
else
  bad "el bundle NO lleva una clave valida; no se despliega"
  grep -rhoE 'AIza.{0,45}' packages/web/dist/assets/*.js | head -1 | sed 's/^/      esto quedo en su lugar: /'
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
  if [ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ] && [ -z "${FIREBASE_SERVICE_ACCOUNT:-}" ]; then
    bad "faltan credenciales: exporta GOOGLE_APPLICATION_CREDENTIALS con el JSON de la cuenta de servicio"
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
