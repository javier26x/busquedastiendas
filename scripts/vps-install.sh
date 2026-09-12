#!/usr/bin/env bash
#
# Deja el scraper corriendo solo en un servidor propio, dos veces al dia.
#
#   sudo bash scripts/vps-install.sh /ruta/a/service-account.json
#   sudo bash scripts/vps-install.sh /ruta/a/service-account.json --hours=8,20
#   sudo bash scripts/vps-install.sh --uninstall
#
# Por que un VPS y no GitHub Actions: las IP de los runners son conocidas y
# varios WAF las rechazan por reputacion. Antes de mover nada conviene medir
# si en este servidor cambia algo, porque no siempre cambia:
#
#   npm run diagnose -- --blocked
#
# Ojo con correr los dos a la vez. El cron de Actions y este timer escribirian
# los mismos documentos y se pisarian el calculo de variacion de precio; el
# workflow tiene un `concurrency` que protege de si mismo, pero no sabe de
# este servidor. Al terminar, el script recuerda como apagar el de Actions.
#
# Es idempotente: correrlo de nuevo actualiza la unidad y reinicia el timer.
#
set -euo pipefail

SERVICE=monitor-precios
UNIT_DIR=/etc/systemd/system
HOURS="9,21"
CREDENTIALS=""
UNINSTALL=0

for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=1 ;;
    --hours=*) HOURS="${arg#--hours=}" ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) echo "Opcion desconocida: $arg" >&2; exit 2 ;;
    *) CREDENTIALS="$arg" ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Hay que correrlo con sudo: instala una unidad de systemd." >&2
  exit 1
fi

if [ "${UNINSTALL}" -eq 1 ]; then
  systemctl disable --now "${SERVICE}.timer" 2>/dev/null || true
  rm -f "${UNIT_DIR}/${SERVICE}.service" "${UNIT_DIR}/${SERVICE}.timer"
  systemctl daemon-reload
  echo "Desinstalado. Las credenciales en /etc/${SERVICE}/ se conservan;"
  echo "borralas a mano si ya no las necesitas."
  exit 0
fi

# --- Comprobaciones antes de tocar nada -----------------------------------

if [ -z "${CREDENTIALS}" ]; then
  echo "Falta la ruta al JSON de la cuenta de servicio de Firebase." >&2
  echo "Es el mismo contenido que el secret FIREBASE_SERVICE_ACCOUNT." >&2
  echo "  sudo bash scripts/vps-install.sh /ruta/a/service-account.json" >&2
  exit 2
fi

if [ ! -f "${CREDENTIALS}" ]; then
  echo "No existe el archivo: ${CREDENTIALS}" >&2
  exit 2
fi

# Que sea un JSON de cuenta de servicio y no cualquier archivo: el error, si
# no, aparece recien a mitad de la primera corrida.
if ! grep -q '"private_key"' "${CREDENTIALS}"; then
  echo "${CREDENTIALS} no parece una cuenta de servicio: no tiene 'private_key'." >&2
  exit 2
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "Este script instala un timer de systemd y aqui no hay systemd." >&2
  echo "En ese caso usa cron:  ${HOURS//,/ y las } horas, 'npm run scrape'." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Falta Node. Instala la 20 o superior; en Debian/Ubuntu:" >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 20 ]; then
  echo "Node ${NODE_MAJOR} es demasiado viejo; hace falta la 20 o superior." >&2
  exit 1
fi

# systemd no hereda el PATH del usuario, asi que se resuelve aqui: con nvm o
# con un Node instalado a mano, un `npm` a secas en la unidad no se encuentra
# y el servicio falla con "203/EXEC" sin mas explicacion.
NPM_BIN="$(command -v npm)"
NODE_BIN_DIR="$(dirname "$(command -v node)")"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
# El timer corre como el dueño del repositorio, no como root: el scraper no
# necesita privilegios y asi el navegador tampoco los tiene.
OWNER="$(stat -c '%U' "${REPO}")"

echo "Repositorio : ${REPO}"
echo "Usuario     : ${OWNER}"
echo "Horario     : ${HOURS} (America/Santiago)"
echo ""

# --- Dependencias ---------------------------------------------------------

echo "Instalando dependencias..."
sudo -u "${OWNER}" env -C "${REPO}" npm ci

# Varias tiendas solo responden a un navegador real. Se instala como el mismo
# usuario para que el binario quede en su cache y el servicio lo encuentre.
echo "Instalando Chromium..."
sudo -u "${OWNER}" env -C "${REPO}" npx playwright install --with-deps chromium

# --- Credenciales ---------------------------------------------------------

install -d -m 700 "/etc/${SERVICE}"
install -m 600 "${CREDENTIALS}" "/etc/${SERVICE}/service-account.json"
chown -R "${OWNER}" "/etc/${SERVICE}"

# --- Unidades -------------------------------------------------------------

cat > "${UNIT_DIR}/${SERVICE}.service" <<EOF
[Unit]
Description=Monitor de precios - corrida del scraper
# Sin esto, al arrancar la maquina el timer puede disparar antes de que haya
# red y la corrida entera falla con "fetch failed" en todas las tiendas.
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=${OWNER}
WorkingDirectory=${REPO}
# Es la via que firebase-admin ya entiende para una clave en disco; el
# proyecto sale de .firebaserc, asi que no hay que declararlo aparte.
Environment=GOOGLE_APPLICATION_CREDENTIALS=/etc/${SERVICE}/service-account.json
# npm invoca a node por PATH, asi que no basta con la ruta del ejecutable.
Environment=PATH=${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin
ExecStart=${NPM_BIN} run scrape
# Una corrida ronda los minutos; el tope es para que un dia malo no deje el
# proceso colgado hasta la siguiente.
TimeoutStartSec=45min

[Install]
WantedBy=multi-user.target
EOF

cat > "${UNIT_DIR}/${SERVICE}.timer" <<EOF
[Unit]
Description=Monitor de precios - dos corridas al dia

[Timer]
OnCalendar=*-*-* ${HOURS}:00:00
# La hora es local de Chile pase lo que pase con el horario de verano, sin
# tener que corregir el cron dos veces al año como en GitHub Actions.
Timezone=America/Santiago
# Si el servidor estaba apagado a esa hora, corre al encender en vez de
# saltarse el dia.
Persistent=true
# Las tiendas reciben menos trafico identico si no llegamos siempre al
# segundo exacto.
RandomizedDelaySec=5min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE}.timer"

echo ""
echo "Listo. El scraper corre a las ${HOURS} hora de Chile."
echo ""
echo "  systemctl list-timers ${SERVICE}.timer   cuando corre la proxima"
echo "  systemctl start ${SERVICE}.service       corre una ahora"
echo "  journalctl -u ${SERVICE}.service -f      ver el log"
echo "  sudo bash scripts/vps-install.sh --uninstall"
echo ""
echo "Falta apagar el cron de GitHub Actions para que no escriban los dos:"
echo "  comenta las lineas 'schedule:' de .github/workflows/scrape.yml"
echo "El boton '↻ Actualizar ahora' del panel seguira disparando el workflow"
echo "de Actions, que sirve igual: es una corrida a demanda, no una repetida."
