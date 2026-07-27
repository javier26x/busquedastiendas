#!/usr/bin/env bash
#
# Diagnostica por que falla el login del panel.
#
#   bash scripts/check-auth.sh
#
# Compara tres cosas que suelen desalinearse:
#   1. la clave que hay en .env.local,
#   2. la clave que quedo realmente en el sitio desplegado,
#   3. si Google acepta esa clave, con y sin restriccion de dominio.
#
set -uo pipefail

PROJECT_ID="${FIREBASE_PROJECT_ID:-busquedasapp}"
SITE="https://${PROJECT_ID}.web.app"
ENV_FILE="$(dirname "$0")/../packages/web/.env.local"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
ok()  { printf '    \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '    \033[31m✗\033[0m %s\n' "$1"; }
info(){ printf '    %s\n' "$1"; }

mask() {
  local v="$1"
  if [ "${#v}" -le 12 ]; then printf '***'; else printf '%s...%s' "${v:0:8}" "${v: -4}"; fi
}

# ---------------------------------------------------------------------------
say "1. Clave en .env.local"
# ---------------------------------------------------------------------------
LOCAL_KEY=""
if [ -f "${ENV_FILE}" ]; then
  LOCAL_KEY="$(grep -E '^VITE_FIREBASE_API_KEY=' "${ENV_FILE}" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
  if [ -z "${LOCAL_KEY}" ]; then
    bad "el archivo existe pero no tiene VITE_FIREBASE_API_KEY"
  elif printf '%s' "${LOCAL_KEY}" | grep -qE '^AIza[A-Za-z0-9_-]{35}$'; then
    ok "$(mask "${LOCAL_KEY}")  (${#LOCAL_KEY} caracteres, formato valido)"
  else
    bad "$(mask "${LOCAL_KEY}")  (${#LOCAL_KEY} caracteres, FORMATO INVALIDO)"
    info "una clave valida es AIza + 35 caracteres alfanumericos"
  fi
else
  bad "no existe ${ENV_FILE}"
  info "generalo con: bash scripts/write-env.sh"
fi

# ---------------------------------------------------------------------------
say "2. Clave que hay en el sitio desplegado"
# ---------------------------------------------------------------------------
DEPLOYED_KEY=""
INDEX="$(curl -sS --max-time 20 "${SITE}/" 2>/dev/null)"

if [ -z "${INDEX}" ]; then
  bad "no se pudo descargar ${SITE}"
else
  # Los bundles llevan hash en el nombre; los sacamos del index.
  ASSETS="$(printf '%s' "${INDEX}" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | sort -u)"
  if [ -z "${ASSETS}" ]; then
    bad "el index no referencia ningun bundle .js"
  fi

  for ASSET in ${ASSETS}; do
    FOUND="$(curl -sS --max-time 30 "${SITE}${ASSET}" 2>/dev/null \
      | grep -oE 'AIza[A-Za-z0-9_-]{35}' | head -1)"
    if [ -n "${FOUND}" ]; then
      DEPLOYED_KEY="${FOUND}"
      ok "$(mask "${DEPLOYED_KEY}")  encontrada en ${ASSET}"
      break
    fi
  done

  if [ -z "${DEPLOYED_KEY}" ]; then
    bad "ningun bundle contiene una clave con formato AIza+35"
    info "senal de que se desplego un build con la clave corrupta o vacia"
    info "esto es lo que hay donde deberia estar la clave:"
    for ASSET in ${ASSETS}; do
      # Sin anclar el formato, para que se vea la clave corrupta tal cual.
      SNIP="$(curl -sS --max-time 30 "${SITE}${ASSET}" 2>/dev/null \
        | grep -oE 'AIza.{0,45}' | head -1)"
      [ -n "${SNIP}" ] && info "  ${ASSET}: ${SNIP}"
    done
  fi
fi

if [ -n "${LOCAL_KEY}" ] && [ -n "${DEPLOYED_KEY}" ]; then
  if [ "${LOCAL_KEY}" = "${DEPLOYED_KEY}" ]; then
    ok "coincide con la de .env.local"
  else
    bad "NO coincide con .env.local: falta reconstruir y volver a desplegar"
    info "  npm run build --workspace @busquedastiendas/web"
    info "  npx --yes firebase-tools@14 deploy --only hosting"
  fi
fi

# ---------------------------------------------------------------------------
say "3. Google acepta la clave?"
# ---------------------------------------------------------------------------
TEST_KEY="${DEPLOYED_KEY:-${LOCAL_KEY}}"

if [ -z "${TEST_KEY}" ]; then
  bad "no hay ninguna clave que probar"
else
  probe_key() {
    local referer="$1"
    local label="$2"
    local body

    if [ -n "${referer}" ]; then
      body="$(curl -sS --max-time 20 \
        "https://identitytoolkit.googleapis.com/v1/projects?key=${TEST_KEY}" \
        -H "Referer: ${referer}" 2>&1)"
    else
      body="$(curl -sS --max-time 20 \
        "https://identitytoolkit.googleapis.com/v1/projects?key=${TEST_KEY}" 2>&1)"
    fi

    local status
    status="$(printf '%s' "${body}" | grep -oE '"status": *"[A-Z_]+"' | head -1 | cut -d'"' -f4)"
    local message
    message="$(printf '%s' "${body}" | grep -oE '"message": *"[^"]*"' | head -1 | cut -d'"' -f4)"

    if printf '%s' "${body}" | grep -q '"projectId"'; then
      ok "${label}: la clave funciona"
    else
      bad "${label}: ${status:-error} — ${message:-sin detalle}"
      case "${status}${message}" in
        *API_KEY_INVALID*|*"API key not valid"*)
          info "  la clave no es reconocida por Google (mal copiada o de otro proyecto)" ;;
        *CONFIGURATION_NOT_FOUND*)
          info "  Firebase Authentication NO esta activado en el proyecto." ;;
        *blocked*|*PERMISSION_DENIED*)
          info "  la restriccion por dominio de la clave esta bloqueando la peticion" ;;
      esac
    fi
  }

  probe_key "" "sin dominio"
  probe_key "${SITE}/" "desde ${SITE}"
fi

# ---------------------------------------------------------------------------
say "4. Estado de Firebase Authentication"
# ---------------------------------------------------------------------------
if command -v gcloud >/dev/null 2>&1; then
  TOKEN="$(gcloud auth print-access-token 2>/dev/null)"
  if [ -n "${TOKEN}" ]; then
    CFG="$(curl -sS --max-time 20 \
      "https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config" \
      -H "Authorization: Bearer ${TOKEN}" 2>/dev/null)"

    if printf '%s' "${CFG}" | grep -q '"authorizedDomains"'; then
      ok "Authentication activo"
      info "dominios: $(printf '%s' "${CFG}" | grep -oE '"authorizedDomains": *\[[^]]*\]' | tr -d '\n ')"

      PROVIDERS="$(curl -sS --max-time 20 \
        "https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/defaultSupportedIdpConfigs" \
        -H "Authorization: Bearer ${TOKEN}" 2>/dev/null)"
      if printf '%s' "${PROVIDERS}" | grep -q 'google.com'; then
        ok "proveedor Google configurado"
      else
        bad "el proveedor Google NO esta configurado"
        info "  https://console.firebase.google.com/project/${PROJECT_ID}/authentication/providers"
      fi
    else
      bad "Authentication NO esta activado todavia"
      info "  https://console.firebase.google.com/project/${PROJECT_ID}/authentication/providers"
      info "  Comenzar -> Google -> Habilitar -> correo de soporte -> Guardar"
    fi
  fi
fi

printf '\n'
