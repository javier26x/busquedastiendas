/**
 * Ejecuta tareas con un tope de concurrencia.
 *
 * El scraper consulta cada tienda en su propio host, asi que nada obliga a
 * esperar a que Falabella conteste para preguntarle a Sodimac. Lo que si hay
 * que respetar es la cortesia *dentro* de cada tienda —una peticion a la vez,
 * con su espera— y eso lo garantiza que cada tarea sea una tienda entera.
 *
 * El tope existe porque las tareas que abren navegador cuestan memoria: sin
 * limite, diez tiendas lanzarian diez contextos de Chromium a la vez.
 */

/**
 * Aplica `worker` sobre cada elemento, con `limit` tareas en vuelo.
 *
 * Devuelve los resultados en el orden de entrada, no en el de terminacion:
 * el resumen de la corrida se lee por tienda y no deberia bailar segun cual
 * conteste antes.
 *
 * Si `worker` lanza, la promesa entera lanza: se espera que el llamador
 * capture por tarea cuando quiera aislarlas (es lo que hace el runner).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const total = items.length;
  if (total === 0) return [];

  const results = new Array<R>(total);
  // Un limite invalido (0, NaN, negativo) degrada a secuencial en vez de
  // colgarse sin ningun trabajador vivo.
  const workers = Math.max(1, Math.min(Math.trunc(limit) || 1, total));

  let next = 0;

  const run = async (): Promise<void> => {
    while (next < total) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index] as T, index);
    }
  };

  await Promise.all(Array.from({ length: workers }, run));
  return results;
}
