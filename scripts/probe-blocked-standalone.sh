#!/usr/bin/env bash
#
# ¿Los bloqueos de las tiendas dependen de la IP?
#
# Version autonoma del diagnostico: solo necesita bash y curl, asi que corre
# en un servidor recien instalado sin clonar el repositorio ni instalar Node.
#
#   curl -sSL https://raw.githubusercontent.com/javier26x/busquedastiendas/claude/monitor-precios-tiendas-j7ldxb/scripts/probe-blocked-standalone.sh | bash
#
# Usa exactamente las mismas cabeceras que el scraper real (packages/scraper/
# src/lib/http.ts), asi lo unico que cambia respecto a la corrida de GitHub
# Actions es desde donde sale la peticion. Cualquier diferencia en el
# resultado es, por lo tanto, atribuible a la IP de origen.
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

# tienda | lo que devolvio en GitHub Actions | URL
#
# Las cuatro ultimas respondieron 200 en Actions: son el testigo. Si aca
# tampoco responden, esta maquina no tiene salida limpia y la comparacion no
# vale nada.
TESTS=(
  'SP Digital|HTTP 403|https://www.spdigital.cl/search?q=notebook'
  'Winpy|HTTP 403|https://www.winpy.cl/search?q=notebook'
  'Corona|fetch failed|https://www.corona.cl/search?q=toalla'
  'La Polar|HTML en vez de JSON|https://www.lapolar.cl/search?q=panales'
  'ABCDIN|HTML en vez de JSON|https://www.abcdin.cl/search?q=notebook'
  'Imperial|HTTP 404|https://www.imperial.cl/search?q=madera'
  'Construmart|HTTP 404|https://www.construmart.cl/catalogsearch/result/?q=cemento'
  'Lider|200 (testigo)|https://www.lider.cl/search?query=panales'
  'Paris|200 (testigo)|https://www.paris.cl/search/?q=panales'
  'Ripley|200 (testigo)|https://simple.ripley.cl/search/panales'
  'Easy|200 (testigo)|https://www.easy.cl/search?q=parrilla'
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

printf '\n\033[1m=== Bloqueos vistos desde esta maquina ===\033[0m\n\n'
printf 'IP publica: %s\n' "$(curl -sS --max-time 10 https://api.ipify.org 2>/dev/null || echo 'no se pudo averiguar')"
printf 'Mismas cabeceras que el scraper real; lo unico distinto es la IP.\n\n'

mejoraron=()
testigos_caidos=()

for row in "${TESTS[@]}"; do
  IFS='|' read -r label en_actions url <<<"${row}"

  # El `|| echo` iria DENTRO de la sustitucion y se sumaria a lo que curl ya
  # escribio, dando "000000". Se deja fallar y se normaliza despues.
  code="$(curl -sS -o "${BODY}" -w '%{http_code}' --max-time 25 --compressed \
    "${headers[@]}" "${url}" 2>/dev/null)"
  [ -z "${code}" ] && code='000'
  size="$(wc -c <"${BODY}" 2>/dev/null || echo 0)"

  # Un 200 puede ser igualmente un muro anti-bot: se revisa el contenido.
  if grep -qiE 'captcha|are you a robot|access denied|incapsula|attention required|just a moment' "${BODY}" 2>/dev/null; then
    resultado="${code} pero es un muro anti-bot"
    ok=0
  elif [ "${code}" = "200" ]; then
    resultado="200 OK (${size} bytes)"
    ok=1
  elif [ "${code}" = "000" ]; then
    resultado="sin respuesta (DNS, TLS o timeout)"
    ok=0
  else
    resultado="HTTP ${code}"
    ok=0
  fi

  marca='  '
  case "${en_actions}" in
    '200 (testigo)')
      [ "${ok}" = "0" ] && testigos_caidos+=("${label}")
      ;;
    *)
      if [ "${ok}" = "1" ]; then
        marca='🟢'
        mejoraron+=("${label}")
      fi
      ;;
  esac

  printf '%s %-13s en Actions: %-22s aqui: %s\n' "${marca}" "${label}" "${en_actions}" "${resultado}"
done

printf '\n'

# Antes de concluir: si las que si respondian en CI tampoco responden aca, esta
# maquina no tiene salida directa y afirmar cualquier cosa seria enganoso.
if [ ${#testigos_caidos[@]} -gt 0 ]; then
  printf '\033[33m⚠ No se puede concluir\033[0m: %s tambien fallan aqui,\n' "$(join_list "${testigos_caidos[@]}")"
  printf '  y en GitHub Actions respondian 200. Esta maquina esta detras de un\n'
  printf '  proxy o cortafuegos que bloquea las tiendas.\n'
  exit 0
fi

if [ ${#mejoraron[@]} -gt 0 ]; then
  printf '\033[32mEstas responden aqui y NO en GitHub Actions:\033[0m %s\n' "$(join_list "${mejoraron[@]}")"
  printf '\nEse bloqueo era por la reputacion de la IP del runner: correr el\n'
  printf 'scraper en este servidor las recupera.\n'
else
  printf 'Ninguna cambio de resultado: el bloqueo no depende de la IP, asi que\n'
  printf 'mover el scraper a este servidor no recuperaria ninguna tienda.\n'
fi

printf '\nOjo: "200 sin productos reconocidos" en Actions (Lider, Paris, Ripley,\n'
printf 'Easy) NO es un bloqueo, la pagina cargaba. Para esas la IP da igual;\n'
printf 'lo que sirve es capturar su XHR.\n\n'
