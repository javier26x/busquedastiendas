# Puesta en marcha

Guía completa desde cero. Toma unos 20 minutos y **no requiere plan de pago**: el
plan gratuito (Spark) alcanza porque el scraper corre en GitHub Actions, no en
Cloud Functions.

---

## 1. Crear el proyecto de Firebase

1. Entra a <https://console.firebase.google.com> con `javier.neo@gmail.com`.
2. **Agregar proyecto** → nombre, por ejemplo `monitor-precios`.
3. Google Analytics: puedes desactivarlo, no se usa.

## 2. Activar Firestore

1. Menú lateral → **Compilación › Firestore Database** → **Crear base de datos**.
2. Modo: **producción** (las reglas de este repo reemplazan las de por defecto).
3. Ubicación: `southamerica-east1` (São Paulo) es la más cercana a Chile.

## 3. Activar el inicio de sesión con Google

1. **Compilación › Authentication** → **Comenzar**.
2. Pestaña **Sign-in method** → **Google** → Habilitar.
3. Elige un correo de soporte y guarda.

## 4. Registrar la app web y obtener la configuración

1. Ícono de engranaje → **Configuración del proyecto**.
2. En **Tus apps**, botón **`</>`** (Web). Nombre: `panel`.
3. **No** marques Firebase Hosting todavía (lo hacemos por CLI).
4. Copia el objeto `firebaseConfig` que te muestra.

Crea el archivo `packages/web/.env.local` con esos valores:

```bash
cp packages/web/.env.example packages/web/.env.local
```

```ini
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=monitor-precios.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=monitor-precios
VITE_FIREBASE_STORAGE_BUCKET=monitor-precios.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abc123
VITE_ALLOWED_EMAILS=javier.neo@gmail.com
```

> `.env.local` está en `.gitignore`. Estos valores no son secretos —viajan al
> navegador en cualquier app de Firebase—, pero igual no hace falta versionarlos.
> Lo que realmente protege los datos es `firestore.rules`.

## 5. Crear la cuenta de servicio (para el scraper)

1. **Configuración del proyecto › Cuentas de servicio**.
2. **Generar nueva clave privada** → descarga el JSON.
3. Guárdalo **fuera del repositorio** (ya está bloqueado en `.gitignore`, pero no
   lo dejes ahí de todos modos).

Para el despliegue del panel esa misma cuenta necesita permiso de Hosting:
en <https://console.cloud.google.com/iam-admin/iam> agrégale el rol
**Firebase Hosting Admin**.

## 6. Desplegar reglas e índices

```bash
npx firebase-tools login
npx firebase-tools use --add        # elige tu proyecto
npx firebase-tools deploy --only firestore:rules,firestore:indexes
```

Esto crea `.firebaserc` local (ignorado por git).

## 7. Primera corrida del scraper

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/ruta/a/tu-service-account.json

# Ver qué encuentra sin escribir nada:
npm run scrape -- --dry-run

# Corrida real:
npm run scrape
```

¿Prefieres ver el panel funcionando antes de la primera corrida real? Carga los
datos de ejemplo:

```bash
npm run seed
```

## 8. Ver el panel en local

```bash
npm run dev
```

Abre <http://localhost:5173> y entra con `javier.neo@gmail.com`.

## 9. Publicar el panel

```bash
npm run build --workspace @busquedastiendas/web
npx firebase-tools deploy --only hosting
```

Te devuelve la URL: `https://<tu-proyecto>.web.app`.

**Importante**: en **Authentication › Settings › Dominios autorizados** verifica que
estén `<tu-proyecto>.web.app` y `localhost`. Sin eso el login falla con
`auth/unauthorized-domain`.

## 10. Automatizar con GitHub Actions

En el repositorio: **Settings › Secrets and variables › Actions › New repository
secret**.

| Secret | Valor |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | Contenido completo del JSON de la cuenta de servicio |
| `VITE_FIREBASE_API_KEY` | Igual que en `.env.local` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Igual que en `.env.local` |
| `VITE_FIREBASE_PROJECT_ID` | Igual que en `.env.local` |
| `VITE_FIREBASE_STORAGE_BUCKET` | Igual que en `.env.local` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Igual que en `.env.local` |
| `VITE_FIREBASE_APP_ID` | Igual que en `.env.local` |
| `VITE_ALLOWED_EMAILS` | `javier.neo@gmail.com` |

Con eso quedan activos tres workflows:

- **Scrape precios** — cron a las 09:00 y 21:00 hora de Chile. También se puede
  disparar a mano desde la pestaña *Actions* (permite elegir tiendas y modo dry-run).
- **Desplegar web** — publica el panel al hacer push a `main` si cambió `packages/web`.
- **CI** — typecheck, tests y build en cada push.

---

## Dar acceso a otra persona

Dos pasos, ambos necesarios:

1. **Firestore**: crea un documento vacío en la colección `allowedUsers` con el
   correo como ID (por ejemplo `allowedUsers/otra@gmail.com`). Esto es lo que
   realmente autoriza la lectura.
2. **Panel**: agrega el correo al secret `VITE_ALLOWED_EMAILS`, separado por coma,
   y vuelve a desplegar. Esto solo mejora el mensaje de error en la UI.

---

## Problemas frecuentes

**`auth/unauthorized-domain` al entrar**
Falta el dominio en Authentication › Settings › Dominios autorizados.

**`permission-denied` al cargar los productos**
Las reglas no están desplegadas, o el correo no coincide.
`npx firebase-tools deploy --only firestore:rules`

**`failed-precondition: The query requires an index`**
`npx firebase-tools deploy --only firestore:indexes` (los índices tardan unos
minutos en construirse).

**Una tienda aparece en rojo en el panel**
Cambió su sitio y su adaptador dejó de reconocerlo. Diagnostica con:

```bash
npm run scrape -- --stores=sodimac --dry-run
```

Las demás tiendas siguen funcionando mientras tanto; el scraper aísla cada consulta.

**El scraper no encuentra nada de una búsqueda**
Puede que las reglas de relevancia estén filtrando de más. Revisa `match` en
`packages/scraper/src/config/searches.ts` y prueba con `--searches=<id> --dry-run`.

**`FIREBASE_SERVICE_ACCOUNT no es JSON válido`**
Pega el JSON completo (incluidas las llaves `{}`) en el secret. También acepta el
mismo JSON codificado en base64.
