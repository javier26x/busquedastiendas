#!/usr/bin/env bash
#
# Guarda en Firestore el token con el que el boton "Actualizar ahora" del
# panel dispara la corrida del scraper. Se corre UNA vez.
#
#   bash scripts/set-github-token.sh
#   GITHUB_TOKEN=github_pat_xxx bash scripts/set-github-token.sh
#
# Necesitas un token de GitHub de alcance minimo:
#   - Fine-grained token, solo el repositorio javier26x/busquedastiendas
#   - Permiso: Actions -> Read and write
#   Nada mas. Con eso solo puede lanzar/ver workflows de ESE repo; si se
#   filtrara, no da acceso al codigo ni a otros repos.
#   Crealo en: https://github.com/settings/personal-access-tokens/new
#
# El token no queda en el repositorio ni en el sitio: va a Firestore, donde
# las reglas solo dejan leerlo a tu correo autorizado.
#
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_ID="${FIREBASE_PROJECT_ID:-busquedasapp}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Falta gcloud. Corre esto en Cloud Shell, donde ya viene instalado." >&2
  exit 1
fi

# Se pide el token sin eco si no vino por variable de entorno.
if [ -z "${GITHUB_TOKEN:-}" ]; then
  printf 'Pega el token de GitHub (no se mostrara): '
  read -rs GITHUB_TOKEN
  printf '\n'
fi

if [ -z "${GITHUB_TOKEN}" ]; then
  echo "No se ingreso ningun token." >&2
  exit 1
fi

# El boton dispara el workflow sobre esta rama. Por defecto, la que este
# consultada ahora (que en este repo es la rama por defecto), no un "main"
# fijo que podria no existir.
GH_REF="${GH_REF:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}"

GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)" \
FIREBASE_PROJECT_ID="${PROJECT_ID}" \
GITHUB_TOKEN="${GITHUB_TOKEN}" \
GH_OWNER="${GH_OWNER:-javier26x}" \
GH_REPO="${GH_REPO:-busquedastiendas}" \
GH_WORKFLOW="${GH_WORKFLOW:-scrape.yml}" \
GH_REF="${GH_REF}" \
node scripts/set-github-token.mjs
