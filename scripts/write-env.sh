#!/usr/bin/env bash
#
# Genera packages/web/.env.local con la configuracion real del proyecto,
# leida desde la API de Firebase. Sin copiar y pegar nada.
#
#   bash scripts/write-env.sh
#   ALLOWED_EMAILS="a@x.com,b@y.com" bash scripts/write-env.sh
#
set -euo pipefail

PROJECT_ID="${FIREBASE_PROJECT_ID:-busquedasapp}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Falta gcloud. En Cloud Shell ya viene instalado." >&2
  exit 1
fi

# Se ejecuta desde la raiz del repositorio para que la ruta de salida calce.
cd "$(dirname "$0")/.."

# Si no se pasa ALLOWED_EMAILS, se conserva la lista que ya este en el
# .env.local actual: regenerar la configuracion no debe recortar en silencio
# quien puede entrar al panel.
if [ -z "${ALLOWED_EMAILS:-}" ] && [ -f packages/web/.env.local ]; then
  ALLOWED_EMAILS="$(grep -E '^VITE_ALLOWED_EMAILS=' packages/web/.env.local | head -1 | cut -d= -f2-)"
fi

GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)" \
FIREBASE_PROJECT_ID="${PROJECT_ID}" \
ALLOWED_EMAILS="${ALLOWED_EMAILS:-javier.neo@gmail.com}" \
node scripts/write-env.mjs
