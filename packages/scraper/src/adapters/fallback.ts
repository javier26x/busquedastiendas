import type { AdapterContext, RawOffer, StoreAdapter } from '../types.js';

/**
 * Combina varias estrategias para una misma tienda.
 *
 * Prueba cada adaptador en orden y se queda con el primero que devuelva
 * productos. Sirve cuando no se sabe de antemano sobre que plataforma corre
 * una tienda: se declaran las posibilidades y el adaptador descubre cual
 * aplica, en vez de fallar entera por una suposicion errada.
 *
 * Las estrategias van de mas barata a mas cara, y la que funciona queda
 * recordada: sin eso, una tienda con seis estrategias pagaria el sondeo
 * completo en cada consulta.
 */

/** Tras estos fallos totales seguidos, se deja de insistir durante la corrida. */
const MAX_CONSECUTIVE_FAILURES = 2;

export function createFallbackAdapter(config: {
  id: string;
  label: string;
  strategies: StoreAdapter[];
  enabled?: boolean;
}): StoreAdapter {
  let preferred = 0;
  let consecutiveFailures = 0;

  return {
    id: config.id,
    label: config.label,
    enabled: config.enabled ?? true,

    async search(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error(
          `se omite: ninguna de las ${config.strategies.length} estrategias funciono en los intentos previos`,
        );
      }

      const order = [...new Set([preferred, ...config.strategies.map((_s, index) => index)])];
      const failures: string[] = [];

      for (const index of order) {
        const strategy = config.strategies[index];
        if (!strategy) continue;

        try {
          const offers = await strategy.search(query, ctx);
          if (offers.length > 0) {
            if (preferred !== index) {
              ctx.log(`${config.label}: estrategia "${strategy.id}" devolvio ${offers.length}`);
              preferred = index;
            }
            consecutiveFailures = 0;
            return offers;
          }
          failures.push(`${strategy.id} -> 0 resultados`);
        } catch (error) {
          failures.push(`${strategy.id} -> ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      consecutiveFailures += 1;
      throw new Error(`ninguna estrategia funciono. ${failures.join(' | ')}`);
    },
  };
}
