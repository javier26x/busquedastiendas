#!/usr/bin/env bash
#
# Alias historico: el despliegue vive ahora en scripts/deploy.sh, que ademas
# del panel sube las reglas y los indices de Firestore. Mantener dos copias
# de los mismos pasos era la receta para que divergieran.
#
# Diferencia con la version anterior: la configuracion ya no se regenera en
# cada despliegue (pisaba la lista de correos con acceso). Para forzarla:
#
#   bash scripts/write-env.sh && bash scripts/deploy.sh
#
set -euo pipefail
exec bash "$(dirname "$0")/deploy.sh" "$@"
