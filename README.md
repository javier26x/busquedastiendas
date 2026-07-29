# Monitor de precios — bodegas de jardín y cajas organizadoras (Chile)

Monitorea dos búsquedas en tiendas chilenas y las muestra en un panel web privado,
ordenables por **precio**, **variación de precio** y **si están en oferta**.

- **Búsquedas**: `bodegas de jardín` y `cajas organizadoras`.
- **Tiendas**: Mercado Libre, Easy, Paris, Sodimac y Falabella.
- **Acceso**: solo `javier.neo@gmail.com`, con Google Sign-In.
- **Actualización**: dos veces al día vía GitHub Actions (gratis, sin plan Blaze).

## Cómo funciona

```
GitHub Actions (cron 2×/día)
        │
        ▼
   packages/scraper ──consulta──► Mercado Libre · Easy · Paris · Sodimac · Falabella
        │
        │ normaliza, filtra ruido, calcula variación y descuento
        ▼
     Firestore  ──products / history / searches / runs──┐
        │                                                │
        ▼                                                ▼
   packages/web (Firebase Hosting) ◄──Google Sign-In── javier.neo@gmail.com
```

El scraper escribe con el Admin SDK; el panel **solo lee**. Ningún cliente puede
escribir en Firestore (ver `firestore.rules`).

## Puesta en marcha

Proyecto de Firebase: **`busquedasapp`** → <https://busquedasapp.web.app>

El paso a paso —activar Firestore, el login con Google, desplegar reglas y configurar
los secrets— está en **[SETUP.md](SETUP.md)**. Resumen:

```bash
npm install

# 1. Panel en local (la configuracion va en packages/web/.env.local, ver SETUP.md)
npm run dev

# 2. Probar el scraper sin escribir nada
npm run scrape -- --dry-run

# 3. Corrida real (necesita FIREBASE_SERVICE_ACCOUNT)
npm run scrape
```

## Estructura

```
packages/scraper/         Node + TypeScript. Consulta tiendas y escribe en Firestore.
  src/adapters/           Un archivo por tipo de tienda (ver "Agregar una tienda").
  src/config/searches.ts  Las búsquedas y sus reglas de relevancia.
  src/config/stores.ts    Registro de tiendas activas.
  src/pipeline/           Normalización, cálculo de variación y escritura.
  fixtures/               Datos de ejemplo para probar sin internet.

packages/web/             React + Vite. Panel privado con Google Sign-In.
  src/lib/sort.ts         Orden y filtros (lógica pura, con tests).
  src/components/         Tabla, filtros, tarjetas de resumen, detalle con gráfico.

firestore.rules           Quién puede leer. Nadie puede escribir desde el cliente.
.github/workflows/        Cron del scraper, CI y despliegue del panel.
```

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Panel web en `http://localhost:5173` |
| `npm run scrape` | Corrida real: consulta tiendas y escribe en Firestore |
| `npm run scrape -- --dry-run` | Consulta y muestra por pantalla, sin escribir |
| `npm run scrape -- --stores=easy,paris` | Limita las tiendas |
| `npm run scrape -- --searches=bodegas-jardin` | Limita las búsquedas |
| `npm run diagnose` | Prueba URLs candidatas por tienda y describe qué devuelven |
| `npm run seed` | Carga productos de ejemplo en Firestore |
| `npm test` | Tests de la lógica pura (32 casos) |
| `npm run typecheck` | TypeScript en ambos paquetes |
| `npm run build` | Compila el panel a `packages/web/dist` |

## Modelo de datos

**`products/{storeId__externalId}`** — un documento por producto y tienda.

| Campo | Significado |
| --- | --- |
| `price` / `listPrice` | Precio vigente / precio normal tachado |
| `isOffer` / `discountPct` | Si hay rebaja real y de cuánto |
| `previousPrice` | Último precio **distinto** observado |
| `priceChange` / `priceChangePct` | Variación respecto a `previousPrice` (negativa = bajó) |
| `priceChangedAt` | Cuándo se movió el precio por última vez |
| `minPrice` / `maxPrice` | Mínimo y máximo históricos observados |
| `searchIds` | A qué búsquedas pertenece (puede ser a las dos) |
| `lastSeenAt` | Última vez que apareció en los resultados |

`previousPrice` guarda el último precio *distinto*, no el de la corrida anterior. Así
"bajó 20%" sigue visible aunque el precio lleve una semana estable, en vez de
resetearse a cero en cada corrida.

**`products/{id}/history/{auto}`** — se agrega una entrada solo cuando el precio
cambia, así el historial es una escalera limpia y no crece con corridas repetidas.

**`runs/{runId}`** — resultado de cada corrida, tienda por tienda. El panel lo
muestra arriba: si Sodimac deja de responder, se ve ahí en vez de quedar con
precios congelados sin aviso.

## Agregar una tienda

En `packages/scraper/src/config/stores.ts`:

```ts
// Tienda sobre VTEX (catálogo público y estable):
createVtexAdapter({ id: 'lider', label: 'Líder', host: 'www.lider.cl' }),

// Tienda que renderiza los datos en el HTML:
createHtmlSearchAdapter({
  id: 'ripley',
  label: 'Ripley',
  base: 'https://simple.ripley.cl',
  buildUrl: (q) => `https://simple.ripley.cl/search/${encodeURIComponent(q)}`,
}),
```

Después: `npm run scrape -- --stores=lider --dry-run` para verificar antes de
dejarla en el cron.

## Agregar una búsqueda

**Desde el panel**, con el botón `+ Búsqueda`. Escribes un nombre —"Pañales"— y
opcionalmente los términos a consultar; el resto se deduce. La búsqueda entra en la
siguiente corrida del cron.

Las búsquedas viven en la colección `searches` de Firestore, que es la fuente de
verdad. Las definiciones de `packages/scraper/src/config/searches.ts` solo se usan
como semilla cuando la colección está vacía: el scraper nunca pisa lo que edites.

### Filtros de relevancia

Los buscadores de las tiendas devuelven mucho ruido, así que cada búsqueda filtra
por el título del producto. Se derivan del nombre y son editables en
*Ajustar filtros de relevancia*:

- **Palabras obligatorias** — una línea por requisito; las palabras de una misma
  línea son alternativas. El título debe cumplir **todas** las líneas.
- **Palabras a excluir** — si el título contiene alguna, se descarta.

Para "Bodegas de jardín" quedan así:

```
bodega, caseta, cobertizo     ← alguna de estas
jardin, exterior, patio       ← y alguna de estas
```

excluyendo `vino, bodegaje, juguete`, que es lo que devuelve el buscador si no.

Al crear "Pañales" se genera `panal` como única palabra obligatoria: se usa la raíz
para que el singular también aparezca.

## Sobre la fragilidad del scraping

Las tiendas cambian su HTML sin avisar. El diseño asume que eso va a pasar:

- **Aislamiento por consulta**: si Sodimac falla, las otras cuatro tiendas igual
  guardan sus datos.
- **Datos estructurados antes que selectores CSS**: se leen los bloques JSON-LD y el
  estado embebido de la SPA, que cambian mucho menos que las clases de CSS.
- **Mercado Libre con doble vía**: primero la API pública; si responde 401/403, cae
  al listado HTML.
- **Estado visible**: `runs` guarda qué tienda falló y por qué, y el panel lo muestra.

### Estado verificado de cada tienda

Medido con corridas reales el 29-07-2026:

| Tienda | Estado | Detalle |
| --- | --- | --- |
| **Falabella** | ✅ activa | Datos estructurados en `__NEXT_DATA__` |
| **Sodimac** | ✅ activa | Igual, pero sin campo `url`: el enlace se arma con el `productId` |
| Paris | 🔍 en curso | 30 tarjetas en el DOM, sin JSON; adaptador por selectores en pruebas |
| Mercado Libre | ⛔ bloqueada | La API exige token y el listado devuelve una interstitial de 23 kB |
| Easy, Ripley | ⛔ bloqueadas | 403 en todas sus rutas, también desde GitHub Actions |
| Líder | ⛔ bloqueada | Responde 200 con una página anti-bot |
| Construmart, Imperial | ⛔ sin datos | Cargan los productos por XHR |

Las bloqueadas quedan **declaradas pero desactivadas**: siguen en el registro para
poder reintentarlas, sin gastar tres minutos por corrida en peticiones condenadas.

Para reactivar una, cambia su `enabled` en `packages/scraper/src/config/stores.ts`.
Para investigar por qué falla:

```bash
npm run diagnose -- --store=paris
npm run diagnose -- --store=paris --dump='[data-testid^="paris-vertical-pod"]'
```

El diagnóstico reporta código HTTP, si hay JSON-LD o estado embebido, en qué rutas
del JSON están los productos, y puede volcar el HTML de un selector concreto.

> Las tiendas se consultan con una espera entre peticiones y sin paralelismo, a un
> volumen comparable al de una persona navegando. Aun así, revisa los términos de
> uso de cada sitio antes de subir la frecuencia del cron.
