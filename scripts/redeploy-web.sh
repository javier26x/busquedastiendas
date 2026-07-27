#!/usr/bin/env bash
#
# Regenera la configuracion, construye, verifica y despliega el panel.
#
#   bash scripts/redeploy-web.sh
#
# El punto importante es la verificacion intermedia: comprueba que el bundle
# construido contiene una clave valida ANTES de subirlo. Una clave corrupta
# compila y despliega sin errores, y el fallo solo aparece despues en el
# navegador; este script corta antes de llegar ahi.
#
set -euo pipefail

cd "$(dirname "$0")/.."

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
ok()  { printf '    \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '    \033[31m✗\033[0m %s\n' "$1"; }

# ---------------------------------------------------------------------------
say "1. Generando packages/web/.env.local desde la API de Firebase"
# ---------------------------------------------------------------------------
if ! bash scripts/write-env.sh; then
  bad "no se pudo generar una configuracion valida; no se despliega nada"
  exit 1
fi

# ---------------------------------------------------------------------------
say "2. Construyendo el panel"
# ---------------------------------------------------------------------------
npm run build --workspace @busquedastiendas/web

# ---------------------------------------------------------------------------
say "3. Verificando el bundle antes de subirlo"
# ---------------------------------------------------------------------------
if grep -rqE 'AIza[A-Za-z0-9_-]{35}' packages/web/dist/assets/*.js; then
  ok "el bundle contiene una clave con formato valido"
else
  bad "el bundle NO contiene una clave valida; se aborta el despliegue"
  printf '    esto es lo que quedo en su lugar:\n'
  grep -rhoE 'AIza.{0,45}' packages/web/dist/assets/*.js | head -1 | sed 's/^/      /'
  exit 1
fi

# ---------------------------------------------------------------------------
say "4. Desplegando"
# ---------------------------------------------------------------------------
npx --yes firebase-tools@14 deploy --only hosting --non-interactive

# ---------------------------------------------------------------------------
say "5. Comprobando el resultado"
# ---------------------------------------------------------------------------
bash scripts/check-auth.sh
