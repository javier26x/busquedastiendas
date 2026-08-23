#!/usr/bin/env bash
#
# ¿Los bloqueos de las tiendas dependen de la IP?
#
# Version autonoma del diagnostico: solo necesita bash y curl, asi que corre
# en un servidor recien instalado sin clonar el repositorio ni instalar Node.
#
#   curl -sSL https://raw.githubusercontent.com/javier26x/busquedastiendas/claude/monitor-precios-tiendas-j7ldxb/scripts/probe-blocked-standalone.sh | bash
#
# Usa las mismas cabeceras Y el mismo seguimiento de redirecciones que el
# scraper real (packages/scraper/src/lib/http.ts), asi lo unico que cambia
# respecto a la corrida de GitHub Actions es desde donde sale la peticion.
#
set -uo pipefail

UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

# Cabeceras de un navegador real. Varios WAF rechazan las peticiones que solo
# traen User-Agent, por incoherentes: sin esto el diagnostico mediria el
# cliente en vez de la IP.
headers=(
  -H "User-Agent: ${UA}"
  -H 'Accept: text/html,application/xhtml+xml'
  -H 'Accept-Language: es-CL,es;q=0.9,es-ES;q=0.8'
  -H 'Cache-Control: no-cache'
  -H 'Sec-Fetch-Dest: document'
  -H 'Sec-Fetch-Mode: navigate'
  -H 'Sec-Fetch-Site: none'
  -H 'Sec-Fetch-User: ?1'
  -H 'Upgrade-Insecure-Requests: 1'
  -H 'sec-ch-ua: "Chromium";v="125", "Not.A/Brand";v="24"'
  -H 'sec-ch-ua-mobile: ?0'
  -H 'sec-ch-ua-platform: "Windows"'
)

# --- Testigos -------------------------------------------------------------
# Tiendas que en GitHub Actions SI funcionaron por cliente HTTP. Si estas
# fallan aqui, la maquina no tiene salida limpia y nada de lo demas se puede
# interpretar.
WITNESS=(
  'Falabella|https://www.falabella.com/falabella-cl/search?Ntt=parrilla'
  'Sodimac|https://www.sodimac.cl/sodimac-cl/search?Ntt=parrilla'
  'Hites|https://www.hites.com/search?q=parrilla'
)

# --- Sospechosas ----------------------------------------------------------
# tienda | lo que devolvio en Actions POR CLIENTE HTTP | URL
#
# Las lineas base salen del log real de la corrida. Ojo: varias de estas ya
# respondian 200 y su problema es que no les reconocemos los productos, no que
# esten bloqueadas. Solo las tres primeras fallaban de verdad.
SUSPECT=(
  'SP Digital|403 en todo|https://www.spdigital.cl/search?q=notebook'
  'Winpy|403 en todo|https://www.winpy.cl/search?q=notebook'
  'Corona|sin respuesta|https://www.corona.cl/search?q=toalla'
  'La Polar|200, sin datos|https://www.lapolar.cl/search?q=panales'
  'ABCDIN|200, sin datos|https://www.abcdin.cl/search?q=notebook'
  'Imperial|200, sin datos|https://www.imperial.cl/search?q=madera'
  'Construmart|200, sin datos|https://www.construmart.cl/catalogsearch/result/?q=cemento'
)

# --- Solo informativas ----------------------------------------------------
# Estas van por navegador en el scraper. Un 403 a curl es lo ESPERADO y no
# dice nada sobre la IP: bloquean por la huella TLS del cliente, no por origen.
BROWSER=(
  'Lider|https://www.lider.cl/search?query=panales'
  'Paris|https://www.paris.cl/search/?q=panales'
  'Ripley|https://simple.ripley.cl/search/panales'
  'Easy|https://www.easy.cl/search?q=parrilla'
)

if ! command -v curl >/dev/null 2>&1; then
  echo "Falta curl. Instalalo con: sudo apt-get install -y curl" >&2
  exit 1
fi

# `${arr[*]}` con IFS solo une por el PRIMER caracter, asi que ", " quedaria
# como ",". Se arma a mano para que se lea bien.
join_list() {
  local out=''
  for item in "$@"; do
    [ -n "${out}" ] && out+=', '
    out+="${item}"
  done
  printf '%s' "${out}"
}

BODY="$(mktemp)"
trap 'rm -f "${BODY}"' EXIT

# Devuelve "codigo|tamano|veredicto" y deja el cuerpo en $BODY.
fetch() {
  local url="$1" code size
  # Vaciar antes: si curl no llega a escribir, el cuerpo de la peticion
  # ANTERIOR seguiria ahi y se analizaria como si fuera esta.
  : >"${BODY}"

  # -L sigue las redirecciones, igual que el cliente real (redirect: 'follow').
  # Sin esto, un 302 se reporta como fallo cuando en realidad lleva a la pagina.
  code="$(curl -sSL -o "${BODY}" -w '%{http_code}' --max-time 25 --compressed \
    "${headers[@]}" "${url}" 2>/dev/null)"
  [ -z "${code}" ] && code='000'
  size="$(wc -c <"${BODY}" 2>/dev/null || echo 0)"

  # El orden importa: sin respuesta se decide por el codigo, nunca por el
  # contenido, que en ese caso esta vacio.
  if [ "${code}" = "000" ]; then
    printf '000|%s|sin respuesta (DNS, TLS o timeout)' "${size}"
  elif grep -qiE 'captcha|are you a robot|access denied|incapsula|attention required|just a moment' "${BODY}" 2>/dev/null; then
    printf '%s|%s|%s pero es un muro anti-bot' "${code}" "${size}" "${code}"
  elif [ "${code}" = "200" ]; then
    printf '200|%s|200 OK (%s bytes)' "${size}" "${size}"
  else
    printf '%s|%s|HTTP %s' "${code}" "${size}" "${code}"
  fi
}

printf '\n\033[1m=== Bloqueos vistos desde esta maquina ===\033[0m\n\n'
printf 'IP publica: %s\n' "$(curl -sS --max-time 10 https://api.ipify.org 2>/dev/null || echo 'no se pudo averiguar')"
printf 'Mismas cabeceras y mismas redirecciones que el scraper real.\n'

# ---------------------------------------------------------------------------
printf '\n\033[1m1. Testigos\033[0m (en Actions funcionaban por HTTP)\n\n'
# ---------------------------------------------------------------------------
caidos=()
for row in "${WITNESS[@]}"; do
  IFS='|' read -r label url <<<"${row}"
  IFS='|' read -r code _size verdict <<<"$(fetch "${url}")"
  [ "${code}" = "200" ] || caidos+=("${label}")
  printf '   %-13s %s\n' "${label}" "${verdict}"
done

if [ ${#caidos[@]} -gt 0 ]; then
  printf '\n\033[33m⚠ No se puede concluir\033[0m: %s deberian responder 200 y no lo hacen.\n' "$(join_list "${caidos[@]}")"
  printf '  Esta maquina no tiene salida limpia a internet; el resto de la tabla\n'
  printf '  no significaria nada.\n\n'
  exit 0
fi

# ---------------------------------------------------------------------------
printf '\n\033[1m2. Las que fallaban por HTTP en Actions\033[0m\n\n'
# ---------------------------------------------------------------------------
mejoraron=()
for row in "${SUSPECT[@]}"; do
  IFS='|' read -r label en_actions url <<<"${row}"
  IFS='|' read -r code _size verdict <<<"$(fetch "${url}")"

  marca='  '
  # Solo cuenta como recuperada si antes fallaba y ahora responde.
  if [ "${code}" = "200" ] && [[ "${en_actions}" != 200* ]]; then
    marca='🟢'
    mejoraron+=("${label}")
  fi

  printf '%s %-13s en Actions: %-16s aqui: %s\n' "${marca}" "${label}" "${en_actions}" "${verdict}"
done

# ---------------------------------------------------------------------------
printf '\n\033[1m3. Las que van por navegador\033[0m (informativo)\n\n'
# ---------------------------------------------------------------------------
for row in "${BROWSER[@]}"; do
  IFS='|' read -r label url <<<"${row}"
  IFS='|' read -r _code _size verdict <<<"$(fetch "${url}")"
  printf '   %-13s %s\n' "${label}" "${verdict}"
done
printf '\n   Un 403 aqui es lo esperado: bloquean la huella TLS de curl, no la IP.\n'
printf '   En el scraper van con Chromium y cargan bien. No dependen de esto.\n'

# ---------------------------------------------------------------------------
printf '\n\033[1mVeredicto\033[0m\n\n'
# ---------------------------------------------------------------------------
if [ ${#mejoraron[@]} -gt 0 ]; then
  printf '\033[32mResponden aqui y NO en GitHub Actions:\033[0m %s\n' "$(join_list "${mejoraron[@]}")"
  printf 'Ese bloqueo era por la reputacion de la IP del runner: mover el scraper\n'
  printf 'a este servidor las recupera.\n\n'
else
  printf 'Ninguna tienda cambio de resultado.\n\n'
  printf 'El bloqueo no depende de la IP, asi que mover el scraper a este\n'
  printf 'servidor no recuperaria ninguna tienda.\n\n'
fi
