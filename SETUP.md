# Puesta en marcha

Proyecto de Firebase: **`busquedasapp`** · Panel: **https://busquedasapp.web.app**

No requiere plan de pago: el plan gratuito (Spark) alcanza, porque el scraper corre
en GitHub Actions y no en Cloud Functions.

## Estado actual

| Paso | Estado |
| --- | --- |
| Proyecto de Firebase creado | ✅ `busquedasapp` |
| App web registrada y configuración obtenida | ✅ |
| `packages/web/.env.local` con la configuración | genera con `bash scripts/write-env.sh` |
| `.firebaserc` apuntando al proyecto | ✅ (versionado, solo el ID) |
| Firestore activado | ⬜ paso 1 |
| Google Sign-In activado | ⬜ paso 2 |
| Reglas e índices desplegados | ⬜ paso 3 |
| Primera corrida del scraper | ⬜ paso 5 |
| Panel publicado | ⬜ paso 7 |
| Cron de GitHub Actions | ⬜ paso 8 |

> **Nota sobre el repositorio público.** `javier26x/busquedastiendas` es público, así
> que la configuración de Firebase vive en `.env.local` (ignorado por git) y en
> GitHub Secrets, no en el código. Estos valores igual quedan visibles en el
> JavaScript del sitio publicado —es así en toda app de Firebase—, pero no hace
> falta además dejarlos indexables en GitHub. Lo que realmente protege los datos son
> `firestore.rules` y los dominios autorizados.

---

## Vía rápida: un solo script

Este script hace los pasos 1, 2, 4, 7 (dominios) y 9. Lo más cómodo es correrlo en
[Cloud Shell](https://console.cloud.google.com/?cloudshell=true&project=busquedasapp),
que ya viene autenticado y con `gcloud`:

```bash
git clone https://github.com/javier26x/busquedastiendas.git
cd busquedastiendas
bash scripts/setup-gcloud.sh
```

Fuera de Cloud Shell, primero `gcloud auth login`.

Es idempotente —se puede correr varias veces— y al final imprime qué sigue.

> Verás algún `reintentando en Ns`: es esperable. Google tarda hasta un par de
> minutos en propagar la activación de las APIs, y el script espera en vez de
> fallar.
Habilita las APIs, crea Firestore en `southamerica-east1`, crea la cuenta de
servicio con sus roles y descarga la clave, fija los dominios autorizados y
restringe la clave de API por dominio.

El único paso que puede quedar pendiente es **habilitar el proveedor Google**: por
API a veces exige un cliente OAuth que la consola crea sola. Si el script avisa que
falló, son 30 segundos en
<https://console.firebase.google.com/project/busquedasapp/authentication/providers>.

Después de correrlo, salta directo al **paso 3** (desplegar reglas).

Si prefieres ir por la consola web, o el script falla en algo, aquí está el
paso a paso manual.

---

## 1. Activar Firestore

1. <https://console.firebase.google.com/project/busquedasapp/firestore>
2. **Crear base de datos** → modo **producción** (las reglas de este repo reemplazan
   las de por defecto).
3. Ubicación: `southamerica-east1` (São Paulo) es la más cercana a Chile.

## 2. Activar el inicio de sesión con Google

1. <https://console.firebase.google.com/project/busquedasapp/authentication/providers>
2. **Comenzar** → **Google** → Habilitar → elige correo de soporte → Guardar.

## 3. Desplegar reglas e índices

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules,firestore:indexes
```

No hace falta `firebase use --add`: `.firebaserc` ya apunta a `busquedasapp`.

Los índices tardan unos minutos en construirse.

## 4. Crear la cuenta de servicio (para el scraper)

1. <https://console.firebase.google.com/project/busquedasapp/settings/serviceaccounts/adminsdk>
2. **Generar nueva clave privada** → descarga el JSON.
3. Guárdalo **fuera del repositorio**.

Para que la misma cuenta pueda publicar el panel, dale el rol **Firebase Hosting
Admin** en <https://console.cloud.google.com/iam-admin/iam?project=busquedasapp>.

## 5. Primera corrida del scraper

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/ruta/a/tu-service-account.json

# Ver qué encuentra sin escribir nada:
npm run scrape -- --dry-run

# Corrida real:
npm run scrape
```

Este `--dry-run` es también la prueba de fuego de los adaptadores: te dirá tienda por
tienda cuáles responden. Si alguna falla, las demás siguen funcionando.

¿Prefieres ver el panel con datos antes de la primera corrida real?

```bash
npm run seed    # carga productos de ejemplo
```

## 6. Ver el panel en local

```bash
npm run dev
```

<http://localhost:5173> → entra con `javier.neo@gmail.com`.

## 7. Publicar el panel

```bash
npm run build --workspace @busquedastiendas/web
npx firebase-tools deploy --only hosting
```

Queda en <https://busquedasapp.web.app>.

**Verifica los dominios autorizados** en
<https://console.firebase.google.com/project/busquedasapp/authentication/settings>:
deben estar `busquedasapp.web.app`, `busquedasapp.firebaseapp.com` y `localhost`.
Sin eso el login falla con `auth/unauthorized-domain`.

## 8. Automatizar con GitHub Actions

En <https://github.com/javier26x/busquedastiendas/settings/secrets/actions> →
**New repository secret**:

| Secret | De dónde sale el valor |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | El JSON completo del paso 4 |
| `VITE_FIREBASE_API_KEY` | `packages/web/.env.local` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `packages/web/.env.local` |
| `VITE_FIREBASE_PROJECT_ID` | `packages/web/.env.local` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `packages/web/.env.local` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `packages/web/.env.local` |
| `VITE_FIREBASE_APP_ID` | `packages/web/.env.local` |
| `VITE_ALLOWED_EMAILS` | `javier.neo@gmail.com` |

Copia cada valor tal cual está en `packages/web/.env.local`. No los pego aquí porque
este archivo sí se versiona en un repositorio público.

Con eso quedan activos tres workflows:

- **Scrape precios** — cron a las 09:00 y 21:00 hora de Chile. También se dispara a
  mano desde *Actions* (permite elegir tiendas y modo dry-run).
- **Desplegar web** — publica el panel al hacer push a `main` si cambió `packages/web`.
- **CI** — typecheck, tests y build en cada push.

## 9. Recomendado: restringir la clave de API

El sitio es público, así que su clave de API también lo es (normal en Firebase). Para
que solo sirva desde tus dominios:

1. <https://console.cloud.google.com/apis/credentials?project=busquedasapp>
2. Abre la clave `Browser key (auto created by Firebase)`.
3. **Restricciones de aplicación** → *Sitios web* → agrega:
   - `https://busquedasapp.web.app/*`
   - `https://busquedasapp.firebaseapp.com/*`
   - `http://localhost:5173/*`

No es obligatorio —las reglas de Firestore ya bloquean la lectura ajena— pero evita
que la clave se use desde otros sitios.

---

## Dar acceso a otra persona

Dos pasos, ambos necesarios:

1. **Firestore**: crea un documento vacío en la colección `allowedUsers` con el
   correo como ID (por ejemplo `allowedUsers/otra@gmail.com`). Esto es lo que
   realmente autoriza la lectura.
2. **Panel**: agrega el correo al secret `VITE_ALLOWED_EMAILS` y a tu `.env.local`,
   separado por coma, y vuelve a desplegar. Esto solo mejora el mensaje en la UI.

---

## Problemas frecuentes

**`auth/unauthorized-domain` al entrar**
Falta el dominio en Authentication › Settings › Dominios autorizados (paso 7).

**`permission-denied` al cargar los productos**
Las reglas no están desplegadas, o el correo no coincide:
`npx firebase-tools deploy --only firestore:rules`

**`failed-precondition: The query requires an index`**
`npx firebase-tools deploy --only firestore:indexes` y espera unos minutos.

**"Falta configurar Firebase" al abrir el panel**
No existe `packages/web/.env.local`, o Vite no se reinició después de crearlo.

**`auth/api-key-not-valid` al entrar**
La clave que quedó en el build no es válida: suele pasar al pegarla a mano truncada
o enmascarada. Regenera el archivo desde el origen y vuelve a desplegar:

```bash
bash scripts/write-env.sh
npm run build --workspace @busquedastiendas/web
npx --yes firebase-tools@14 deploy --only hosting
```

**Una tienda aparece en rojo en el panel**
Cambió su sitio y su adaptador dejó de reconocerlo. Diagnostica con:

```bash
npm run scrape -- --stores=sodimac --dry-run
```

Las demás tiendas siguen funcionando; el scraper aísla cada consulta.

**El scraper no encuentra nada de una búsqueda**
Puede que las reglas de relevancia filtren de más. Revisa `match` en
`packages/scraper/src/config/searches.ts` y prueba con `--searches=<id> --dry-run`.

**`FIREBASE_SERVICE_ACCOUNT no es JSON válido`**
Pega el JSON completo (incluidas las llaves `{}`). También acepta base64.
