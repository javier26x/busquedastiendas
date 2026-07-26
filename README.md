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

El paso a paso completo —crear el proyecto de Firebase, obtener las credenciales y
configurar los secrets— está en **[SETUP.md](SETUP.md)**. Resumen:

```bash
npm install

# 1. Panel en local (necesita packages/web/.env.local, ver SETUP.md)
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

En `packages/scraper/src/config/searches.ts`. Las reglas de `match` filtran el ruido
del buscador de cada tienda:

```ts
{
  id: 'escaleras',
  label: 'Escaleras',
  queries: ['escalera aluminio', 'escalera tijera'],
  match: {
    // El título debe tener al menos un término de cada grupo...
    requireAll: [['escalera'], ['aluminio', 'tijera', 'telescopica']],
    // ...y ninguno de estos.
    exclude: ['juguete', 'miniatura'],
  },
  enabled: true,
}
```

La web toma las pestañas de la colección `searches`, que el scraper sincroniza sola
en cada corrida.

## Sobre la fragilidad del scraping

Las tiendas cambian su HTML sin avisar. El diseño asume que eso va a pasar:

- **Aislamiento por consulta**: si Sodimac falla, las otras cuatro tiendas igual
  guardan sus datos.
- **Datos estructurados antes que selectores CSS**: se leen los bloques JSON-LD y el
  estado embebido de la SPA, que cambian mucho menos que las clases de CSS.
- **Mercado Libre con doble vía**: primero la API pública; si responde 401/403, cae
  al listado HTML.
- **Estado visible**: `runs` guarda qué tienda falló y por qué, y el panel lo muestra.

Mercado Libre, Easy y Paris son las vías más sólidas (APIs públicas o estructura
estable). Sodimac y Falabella son best-effort: si dejan de responder, aparecerán
en rojo en el panel y basta ajustar su adaptador.

> Las tiendas se consultan con una espera entre peticiones y sin paralelismo, a un
> volumen comparable al de una persona navegando. Aun así, revisa los términos de
> uso de cada sitio antes de subir la frecuencia del cron.
