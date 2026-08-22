# Monitor de precios — bodegas de jardín y cajas organizadoras (Chile)

Monitorea dos búsquedas en tiendas chilenas y las muestra en un panel web privado,
ordenables por **precio**, **variación de precio** y **si están en oferta**.

- **Búsquedas**: se administran desde el panel; arranca con `bodegas de jardín` y
  `cajas organizadoras`.
- **Tiendas activas**: Falabella, Sodimac, IKEA y PC Factory (ver [estado de cada tienda](#estado-verificado-de-cada-tienda)).
- **Acceso**: solo `javier.neo@gmail.com`, con Google Sign-In.
- **Actualización**: dos veces al día vía GitHub Actions (gratis, sin plan Blaze).

## Cómo funciona

```
GitHub Actions (cron 2×/día)
        │
        ▼
   packages/scraper ──consulta──► Falabella · Sodimac · IKEA · PC Factory
        │
        │ normaliza, filtra ruido, calcula variación y descuento
        ▼
     Firestore  ──products / history / searches / runs──┐
        │                                                │
        ▼                                                ▼
   packages/web (Firebase Hosting) ◄──Google Sign-In── javier.neo@gmail.com
```

El scraper escribe con el Admin SDK. Desde el panel solo se pueden administrar las
búsquedas, y desligarles productos al borrar una: los precios y el historial son
únicamente del scraper (ver `firestore.rules`).

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

firestore.rules           Quién lee, y lo único que el panel puede escribir.
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
| `npm run purge -- --store=ikea` | Borra los productos de una tienda y su historial |
| `npm run diagnose -- --probe=www.tienda.cl` | Prueba las 4 APIs públicas y dice cuál sirve |
| `npm test` | Tests de la lógica pura (93 casos) |
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

Primero, averigua sobre qué corre:

```bash
npm run diagnose -- --probe=www.tienda.cl
```

Si alguna API pública responde, imprime la línea para pegar en
`packages/scraper/src/config/stores.ts`. Si ninguna responde, basta el host y la
cadena prueba las [seis técnicas](#las-seis-formas-de-leer-una-tienda) sola:

```ts
createUnknownPlatformStore({ id: 'tienda', label: 'Tienda', host: 'www.tienda.cl' }),
```

Después: `npm run scrape -- --stores=tienda --dry-run` para ver qué técnica
funcionó antes de dejarla en el cron.

## Agregar una búsqueda

**Desde el panel**, con el botón `+ Búsqueda`. Escribes un nombre —"Pañales"— y
opcionalmente los términos a consultar; el resto se deduce. La búsqueda entra en la
siguiente corrida del cron.

Las búsquedas viven en la colección `searches` de Firestore, que es la fuente de
verdad. Las definiciones de `packages/scraper/src/config/searches.ts` solo se usan
para sembrar un proyecto nuevo, una única vez: el scraper nunca pisa lo que edites
ni resucita lo que borres.

### Borrar una búsqueda

El panel le quita esa etiqueta a sus productos. Los que también pertenecen a otra
búsqueda se conservan con su historial intacto; los que quedan sin ninguna
desaparecen del panel al instante y los borra la siguiente corrida del scraper,
que es quien puede arrastrar también su subcolección `history`.

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

| Tienda | Cómo se lee | Estado |
| --- | --- | --- |
| **Falabella** | HTTP · datos estructurados | ✅ |
| **Sodimac** | HTTP · datos estructurados (enlace armado del `productId`) | ✅ |
| **IKEA** | Navegador · tarjetas del DOM, vía `ikea.com/cl/es` | ✅ |
| **PC Factory** | HTTP · API REST propia (`api.pcfactory.cl`) | ✅ |
| Paris, Easy, Ripley, Líder | Navegador · captura del XHR | 🔄 reactivadas |
| Construmart, Imperial | Sondeo de las 6 técnicas | 🔄 reactivadas |
| Hites, La Polar, ABCDIN, Corona, SP Digital, Winpy | Sondeo de las 6 técnicas | 🆕 sin verificar |
| Mercado Libre | — | ⛔ API con token e interstitial anti-bot |

Las marcadas 🔄 fallaban con las técnicas anteriores y se reactivaron porque
ahora hay una que ataca su causa: cargan por XHR y ese JSON ya se captura. Las 🆕
están declaradas solo por su host, a la espera de la primera corrida.

Para ver cuáles respondieron y con qué técnica:

```bash
npm run scrape -- --dry-run
```

Cada tienda que falle queda con su motivo en el resumen de la corrida y en el
panel. Apagar una es poner `enabled: false` en su bloque de
`packages/scraper/src/config/stores.ts`.

#### Qué precio se guarda

Varias tiendas publican más de un precio para el mismo producto. Se guarda **el que
paga cualquiera**, no el más bajo:

| Tienda | Se guarda | Se ignora |
| --- | --- | --- |
| Falabella, Sodimac | precio normal | precio CMR |
| PC Factory | `precio.normal` | `efectivo`, `debito`, `bancoEstado` |
| Cualquiera leída por JSON | el campo sin condiciones | lo que mencione tarjeta, banco, efectivo, débito o cuotas |

El `listPrice` tachado sale de `referencia`, que es justo el número que se infla
antes de un Cyber: con el historial de `history` se ve cuándo subió la referencia sin
que bajara el precio real.

### Las seis formas de leer una tienda

El scraper las intenta en orden de coste y se queda con la primera que dé
resultados. La que funcionó queda recordada, así que el sondeo se paga una vez
y no en cada consulta:

| # | Técnica | Cuándo aplica |
| --- | --- | --- |
| 1 | **VTEX, catálogo clásico** | `/api/catalog_system/pub/products/search` |
| 2 | **VTEX Intelligent Search** | tiendas VTEX que ya migraron y dejaron el clásico vacío |
| 3 | **Shopify** | `/search/suggest.json`, la búsqueda predictiva del propio sitio |
| 4 | **WooCommerce Store API** | `/wp-json/wc/store/v1/products`, la API del carrito |
| 5 | **Datos estructurados del HTML** | JSON-LD o el estado embebido (`__NEXT_DATA__`) |
| 6 | **Navegador headless** | 403 por huella TLS, o productos que llegan por XHR |

Las cuatro primeras devuelven un JSON limpio con una sola petición: no hay HTML
que interpretar ni nada que se rompa cuando la tienda rediseña. Las plataformas
las traen de fábrica y muchas tiendas no saben que están abiertas.

Como el envoltorio y los nombres de campo cambian de una a otra,
`lib/json-catalog.ts` no asume ninguna ruta: recorre la respuesta buscando
objetos con nombre y precio, y prueba los nombres plausibles de cada dato. Por
eso una tienda nueva suele necesitar solo su host.

#### Capturar el XHR

Dentro del navegador hay tres lecturas, de mejor a peor: datos estructurados,
**el JSON que la propia página pide por detrás**, y raspar las tarjetas del DOM.

La del medio es la que rescata a las tiendas cuyo HTML no dice nada. Cargan los
productos desde su propia API y esa respuesta es un JSON limpio, mucho mejor que
el maquetado. Cuando funciona, el log anota la dirección:

```
[paris] Paris: 24 desde el XHR de la tienda (navegador) {"api":"https://.../api/search?q=..."}
```

Esa dirección es el primer paso para dejar de necesitar navegador: se declara con
`createJsonApiAdapter` y la tienda pasa a costar una petición. Es exactamente
como se encontró la API de PC Factory.

Con `CHROMIUM_PATH` se puede apuntar a un Chromium ya instalado.

### Agregar una tienda nueva

```bash
npm run diagnose -- --probe=www.tienda.cl
```

Prueba las cuatro APIs públicas y, si alguna responde, imprime la línea exacta
para pegar en `config/stores.ts`. Si ninguna responde, `createUnknownPlatformStore`
sondea las seis técnicas con solo declarar el host.

Con `CHROMIUM_PATH` se puede apuntar a un Chromium ya instalado, útil en
imágenes de CI que lo traen incluido.

### Diagnosticar una tienda

```bash
npm run diagnose -- --store=paris
npm run diagnose -- --store=paris --dump='[data-testid^="paris-vertical-pod"]'
```

Reporta código HTTP, si hay JSON-LD o estado embebido, en qué rutas del JSON
están los productos, y la anatomía de una tarjeta: cuántos enlaces tiene, qué
elementos llevan precio y cuáles son los candidatos a título.

> Las tiendas se consultan con una espera entre peticiones y sin paralelismo, a un
> volumen comparable al de una persona navegando. Aun así, revisa los términos de
> uso de cada sitio antes de subir la frecuencia del cron.
