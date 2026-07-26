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
#   - gcloud instalado y autenticado:  gcloud auth login
#   - ser Owner del proyecto busquedasapp
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
if gcloud firestore databases describe --database='(default)' --quiet >/dev/null 2>&1; then
  ok "ya existe (no se toca: la ubicacion no se puede cambiar despues)"
else
  gcloud firestore databases create \
    --location="${LOCATION}" \
    --type=firestore-native \
    --quiet
  ok "creada en ${LOCATION} en modo nativo"
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
fi

# roles/datastore.user                     -> el scraper escribe en Firestore
# roles/firebase.developAdmin              -> desplegar hosting y reglas
# roles/serviceusage.serviceUsageConsumer  -> firebase-tools consulta las APIs
for ROLE in \
  roles/datastore.user \
  roles/firebase.developAdmin \
  roles/serviceusage.serviceUsageConsumer
do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet >/dev/null
  ok "rol ${ROLE}"
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

# Inicializa Auth si el proyecto nunca lo uso. Si ya estaba, responde error y
# seguimos: es esperable.
if curl -sS -o /dev/null -w '%{http_code}' -X POST \
    "${IDT}/v2/projects/${PROJECT_ID}/identityPlatform:initializeAuth" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{}' | grep -q '^20'; then
  ok "Authentication inicializado"
else
  warn "Authentication ya estaba inicializado (o requiere la consola)"
fi

# Dominios autorizados: sin esto el login falla con auth/unauthorized-domain.
DOMAINS_CODE="$(curl -sS -o /tmp/idt-domains.json -w '%{http_code}' -X PATCH \
  "${IDT}/admin/v2/projects/${PROJECT_ID}/config?updateMask=authorizedDomains" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"authorizedDomains\":${AUTH_DOMAINS}}")"

if [ "${DOMAINS_CODE}" = "200" ]; then
  ok "dominios autorizados: localhost, ${PROJECT_ID}.firebaseapp.com, ${PROJECT_ID}.web.app"
else
  warn "no se pudieron fijar los dominios (HTTP ${DOMAINS_CODE}); detalle en /tmp/idt-domains.json"
fi

# Proveedor Google. Este es el paso menos confiable por API: Firebase crea el
# cliente OAuth automaticamente al habilitarlo desde la consola, y por API
# puede exigir clientId/clientSecret.
GOOGLE_CODE="$(curl -sS -o /tmp/idt-google.json -w '%{http_code}' -X POST \
  "${IDT}/admin/v2/projects/${PROJECT_ID}/defaultSupportedIdpConfigs?idpId=google.com" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true}')"

case "${GOOGLE_CODE}" in
  200) ok "proveedor Google habilitado" ;;
  409) ok "proveedor Google ya estaba habilitado" ;;
  *)
    warn "no se pudo habilitar Google por API (HTTP ${GOOGLE_CODE})"
    warn "hazlo en 30 segundos aca:"
    warn "https://console.firebase.google.com/project/${PROJECT_ID}/authentication/providers"
    ;;
esac

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

curl -sS "${IDT}/admin/v2/projects/${PROJECT_ID}/config" \
  -H "Authorization: Bearer ${TOKEN}" \
  | grep -o '"authorizedDomains":\[[^]]*\]' \
  | sed 's/^/    Auth: /' || warn "no se pudo leer la config de Auth"

# ---------------------------------------------------------------------------
say "Listo. Siguientes pasos"
# ---------------------------------------------------------------------------
cat <<EOF
    1. Desplegar reglas e indices de Firestore:
         npx firebase-tools login
         npx firebase-tools deploy --only firestore:rules,firestore:indexes

    2. Primera corrida del scraper:
         export GOOGLE_APPLICATION_CREDENTIALS="${KEY_PATH}"
         npm run scrape -- --dry-run     # ver que tiendas responden
         npm run scrape                  # corrida real

    3. Ver el panel:
         npm run dev                     # http://localhost:5173

    4. Cargar el secret en GitHub (necesita la CLI 'gh', o hazlo por la web):
         gh secret set FIREBASE_SERVICE_ACCOUNT < "${KEY_PATH}"

       Los VITE_* salen de packages/web/.env.local:
         while IFS='=' read -r k v; do
           case "\$k" in VITE_*) gh secret set "\$k" --body "\$v" ;; esac
         done < packages/web/.env.local
EOF
