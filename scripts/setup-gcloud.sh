#!/usr/bin/env bash
#
# Configura el proyecto de Firebase/Google Cloud desde la linea de comandos.
#
#   bash scripts/setup-gcloud.sh
#
# Es idempotente: se puede correr varias veces sin romper nada. Cada paso
# revisa primero si ya esta hecho.
#
# Requisitos previos:
#   - ser Owner del proyecto busquedasapp
#   - gcloud autenticado. En Cloud Shell ya lo esta; fuera de ahi:
#       gcloud auth login
#
# Nota: `gcloud services enable` devuelve antes de que las APIs queden
# utilizables, asi que los pasos que dependen de ellas se reintentan con
# espera creciente. Es normal ver algun "reintentando en Ns" la primera vez.
#
set -euo pipefail

PROJECT_ID="busquedasapp"
LOCATION="southamerica-east1"          # Sao Paulo, lo mas cercano a Chile
SA_NAME="scraper-precios"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
KEY_PATH="${HOME}/${PROJECT_ID}-service-account.json"

# Dominios desde los que se permite iniciar sesion.
AUTH_DOMAINS='["localhost","'"${PROJECT_ID}"'.firebaseapp.com","'"${PROJECT_ID}"'.web.app"]'
# Origenes desde los que se permite usar la clave de API del navegador.
API_KEY_REFERRERS="https://${PROJECT_ID}.web.app/*,https://${PROJECT_ID}.firebaseapp.com/*,http://localhost:5173/*"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
ok()  { printf '    \033[32m✓\033[0m %s\n' "$1"; }
warn(){ printf '    \033[33m!\033[0m %s\n' "$1"; }

LAST_ERROR=""

# Reintenta un comando con espera creciente.
#
# `gcloud services enable` devuelve el control antes de que la API quede
# realmente utilizable: el backend de Google tarda entre segundos y un par de
# minutos en propagar la activacion. Sin esto, el primer paso que use una API
# recien habilitada falla con SERVICE_DISABLED.
#
#   retry <intentos> <comando...>
retry() {
  local attempts="$1"; shift
  local delay=10
  local n=1

  while true; do
    if "$@"; then
      return 0
    fi
    if [ "${n}" -ge "${attempts}" ]; then
      return 1
    fi
    warn "intento ${n}/${attempts} sin exito; reintentando en ${delay}s (propagacion de APIs)"
    sleep "${delay}"
    n=$(( n + 1 ))
    delay=$(( delay * 2 ))
  done
}

# ---------------------------------------------------------------------------
say "Proyecto activo"
# ---------------------------------------------------------------------------
gcloud config set project "${PROJECT_ID}" --quiet
ok "${PROJECT_ID}"

# ---------------------------------------------------------------------------
say "Habilitando APIs"
# ---------------------------------------------------------------------------
# Habilitarlas todas de una es mas rapido que una por una.
gcloud services enable \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  firebase.googleapis.com \
  firestore.googleapis.com \
  firebaserules.googleapis.com \
  firebasehosting.googleapis.com \
  identitytoolkit.googleapis.com \
  apikeys.googleapis.com \
  iam.googleapis.com \
  --quiet
ok "APIs habilitadas"

# ---------------------------------------------------------------------------
say "Base de datos Firestore"
# ---------------------------------------------------------------------------

# Crea la base, tratando "ya existe" como exito. Guarda la salida para
# mostrarla solo si se agotan los reintentos, y no ensuciar la consola con el
# error de propagacion en cada vuelta.
create_firestore() {
  local out
  if out="$(gcloud firestore databases create \
      --location="${LOCATION}" \
      --type=firestore-native \
      --quiet 2>&1)"; then
    return 0
  fi
  if printf '%s' "${out}" | grep -qiE 'already exists|ALREADY_EXISTS'; then
    return 0
  fi
  LAST_ERROR="${out}"
  return 1
}

if gcloud firestore databases describe --database='(default)' --quiet >/dev/null 2>&1; then
  ok "ya existe (no se toca: la ubicacion no se puede cambiar despues)"
elif retry 5 create_firestore; then
  ok "creada en ${LOCATION} en modo nativo"
else
  warn "no se pudo crear Firestore despues de varios intentos:"
  printf '%s\n' "${LAST_ERROR}" | sed 's/^/      /'
  warn "si el error es SERVICE_DISABLED, espera un minuto y vuelve a correr el script"
  exit 1
fi

# ---------------------------------------------------------------------------
say "Cuenta de servicio para el scraper"
# ---------------------------------------------------------------------------
if gcloud iam service-accounts describe "${SA_EMAIL}" --quiet >/dev/null 2>&1; then
  ok "ya existe: ${SA_EMAIL}"
else
  gcloud iam service-accounts create "${SA_NAME}" \
    --display-name="Scraper de precios" \
    --description="Escribe productos en Firestore y despliega el panel" \
    --quiet
  ok "creada: ${SA_EMAIL}"

  # Una cuenta recien creada tarda unos segundos en ser visible para la API
  # de politicas IAM, que es la que asigna los roles mas abajo.
  sa_visible() { gcloud iam service-accounts describe "${SA_EMAIL}" --quiet >/dev/null 2>&1; }
  retry 4 sa_visible >/dev/null || warn "la cuenta aun no se lista; se reintentara al asignar roles"
fi

# roles/datastore.user                     -> el scraper escribe en Firestore
# roles/firebase.developAdmin              -> desplegar hosting y reglas
# roles/serviceusage.serviceUsageConsumer  -> firebase-tools consulta las APIs

# La API de politicas puede no ver todavia una cuenta recien creada y
# responder "does not exist"; por eso tambien va con reintentos.
grant_role() {
  local role="$1"
  local out
  if out="$(gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
      --member="serviceAccount:${SA_EMAIL}" \
      --role="${role}" \
      --condition=None \
      --quiet 2>&1)"; then
    return 0
  fi
  LAST_ERROR="${out}"
  return 1
}

for ROLE in \
  roles/datastore.user \
  roles/firebase.developAdmin \
  roles/serviceusage.serviceUsageConsumer
do
  if retry 5 grant_role "${ROLE}"; then
    ok "rol ${ROLE}"
  else
    warn "no se pudo asignar ${ROLE}:"
    printf '%s\n' "${LAST_ERROR}" | sed 's/^/      /'
    exit 1
  fi
done

# ---------------------------------------------------------------------------
say "Clave de la cuenta de servicio"
# ---------------------------------------------------------------------------
if [ -f "${KEY_PATH}" ]; then
  warn "ya existe ${KEY_PATH}, no se genera otra"
  warn "para rotarla: borra el archivo y vuelve a correr este script"
else
  gcloud iam service-accounts keys create "${KEY_PATH}" \
    --iam-account="${SA_EMAIL}" \
    --quiet
  chmod 600 "${KEY_PATH}"
  ok "guardada en ${KEY_PATH} (fuera del repositorio)"
fi

# ---------------------------------------------------------------------------
say "Firebase Authentication"
# ---------------------------------------------------------------------------
TOKEN="$(gcloud auth print-access-token)"
IDT="https://identitytoolkit.googleapis.com"
AUTH_CONSOLE="https://console.firebase.google.com/project/${PROJECT_ID}/authentication/providers"
AUTH_PENDING=0

# La API de administracion de Auth solo responde una vez que Authentication
# fue activado desde la consola. Mientras no lo este devuelve 403, y no sirve
# de nada reintentar: hay que activarlo a mano una unica vez.
CONFIG_CODE="$(curl -sS -o /tmp/idt-config.json -w '%{http_code}' \
  "${IDT}/admin/v2/projects/${PROJECT_ID}/config" \
  -H "Authorization: Bearer ${TOKEN}" \
      -H "x-goog-user-project: ${PROJECT_ID}")"

if [ "${CONFIG_CODE}" != "200" ]; then
  AUTH_PENDING=1
  warn "Authentication aun no esta activado en el proyecto (HTTP ${CONFIG_CODE})."
  warn "Es el unico paso que hay que hacer a mano, y toma 30 segundos:"
  warn "  ${AUTH_CONSOLE}"
  warn "  Comenzar -> Google -> Habilitar -> elegir correo de soporte -> Guardar"
  warn "Al activarlo, Firebase agrega solo los dominios autorizados necesarios."
else
  ok "Authentication activo"

  # Firebase agrega localhost, <proyecto>.web.app y <proyecto>.firebaseapp.com
  # por su cuenta al activar Auth. Solo tocamos la config si falta alguno.
  MISSING=0
  for DOMAIN in "localhost" "${PROJECT_ID}.firebaseapp.com" "${PROJECT_ID}.web.app"; do
    grep -q "\"${DOMAIN}\"" /tmp/idt-config.json || MISSING=1
  done

  if [ "${MISSING}" -eq 0 ]; then
    ok "dominios autorizados ya correctos"
  else
    set_auth_domains() {
      local code
      code="$(curl -sS -o /tmp/idt-domains.json -w '%{http_code}' -X PATCH \
        "${IDT}/admin/v2/projects/${PROJECT_ID}/config?updateMask=authorizedDomains" \
        -H "Authorization: Bearer ${TOKEN}" \
      -H "x-goog-user-project: ${PROJECT_ID}" \
        -H "Content-Type: application/json" \
        -d "{\"authorizedDomains\":${AUTH_DOMAINS}}")"
      [ "${code}" = "200" ]
    }

    if retry 3 set_auth_domains; then
      ok "dominios autorizados actualizados"
    else
      warn "no se pudieron fijar los dominios; detalle en /tmp/idt-domains.json"
      warn "hazlo a mano en Authentication > Settings > Dominios autorizados"
    fi
  fi
fi

# Proveedor Google. Solo tiene sentido intentarlo si Auth ya esta activo:
# si no, el paso manual de arriba ya lo deja habilitado de paso.
if [ "${AUTH_PENDING}" -eq 0 ]; then
  GOOGLE_CODE="$(curl -sS -o /tmp/idt-google.json -w '%{http_code}' -X POST \
    "${IDT}/admin/v2/projects/${PROJECT_ID}/defaultSupportedIdpConfigs?idpId=google.com" \
    -H "Authorization: Bearer ${TOKEN}" \
      -H "x-goog-user-project: ${PROJECT_ID}" \
    -H "Content-Type: application/json" \
    -d '{"enabled":true}')"

  case "${GOOGLE_CODE}" in
    200) ok "proveedor Google habilitado" ;;
    409) ok "proveedor Google ya estaba habilitado" ;;
    *)
      # Firebase crea el cliente OAuth solo al habilitarlo desde la consola;
      # por API puede exigir clientId/clientSecret.
      AUTH_PENDING=1
      warn "no se pudo habilitar Google por API (HTTP ${GOOGLE_CODE})"
      warn "hazlo en 30 segundos aca: ${AUTH_CONSOLE}"
      ;;
  esac
fi

# ---------------------------------------------------------------------------
say "Restringiendo la clave de API del navegador"
# ---------------------------------------------------------------------------
# El `|| true` es necesario: con `set -o pipefail` un fallo aca abortaria
# el script entero por un paso que es opcional.
KEY_NAME="$(gcloud services api-keys list \
  --filter='displayName~Browser' \
  --format='value(name)' --quiet 2>/dev/null | head -1 || true)"

if [ -z "${KEY_NAME}" ]; then
  warn "no se encontro la 'Browser key' automatica; restringela a mano en:"
  warn "https://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}"
else
  gcloud services api-keys update "${KEY_NAME}" \
    --allowed-referrers="${API_KEY_REFERRERS}" \
    --quiet >/dev/null
  ok "clave restringida a ${API_KEY_REFERRERS}"
fi

# ---------------------------------------------------------------------------
say "Verificacion"
# ---------------------------------------------------------------------------
gcloud firestore databases describe --database='(default)' \
  --format='value(name,locationId,type)' --quiet 2>/dev/null \
  | sed 's/^/    Firestore: /' || warn "Firestore no responde"

if [ "${AUTH_PENDING}" -eq 0 ]; then
  curl -sS "${IDT}/admin/v2/projects/${PROJECT_ID}/config" \
    -H "Authorization: Bearer ${TOKEN}" \
      -H "x-goog-user-project: ${PROJECT_ID}" \
    | grep -o '"authorizedDomains":\[[^]]*\]' \
    | sed 's/^/    Auth: /' || warn "no se pudo leer la config de Auth"
else
  printf '    Auth: pendiente de activar en la consola\n'
fi

# ---------------------------------------------------------------------------
say "Siguientes pasos"
# ---------------------------------------------------------------------------
if [ "${AUTH_PENDING}" -ne 0 ]; then
  cat <<EOF
    0. PRIMERO, activar Authentication (unico paso manual, 30 segundos):
         ${AUTH_CONSOLE}
         Comenzar -> Google -> Habilitar -> correo de soporte -> Guardar

EOF
fi

# firebase-tools acepta la cuenta de servicio via GOOGLE_APPLICATION_CREDENTIALS,
# asi se evita el login interactivo con navegador.
cat <<EOF
    1. Desplegar reglas e indices de Firestore:
         export GOOGLE_APPLICATION_CREDENTIALS="${KEY_PATH}"
         npx --yes firebase-tools@14 deploy --only firestore:rules,firestore:indexes

    2. Primera corrida del scraper (misma variable ya exportada):
         npm install
         npm run scrape -- --dry-run     # ver que tiendas responden
         npm run scrape                  # corrida real

    3. Ver el panel:
         npm run dev                     # http://localhost:5173

    4. Cargar los secrets en GitHub (necesita la CLI 'gh', o hazlo por la web):
         gh secret set FIREBASE_SERVICE_ACCOUNT < "${KEY_PATH}"

       Los VITE_* salen de packages/web/.env.local, que no viene en el clon.
       Copialo desde .env.example y completalo, o crea los secrets a mano.
EOF
