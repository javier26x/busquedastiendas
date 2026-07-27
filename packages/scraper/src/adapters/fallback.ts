import type { AdapterContext, RawOffer, StoreAdapter } from '../types.js';

/**
 * Combina varias estrategias para una misma tienda.
 *
 * Prueba cada adaptador en orden y se queda con el primero que devuelva
 * productos. Sirve cuando no se sabe de antemano sobre que plataforma corre
 * una tienda: se declaran las dos o tres posibilidades y el adaptador
 * descubre cual aplica, en vez de fallar entera por una suposicion errada.
 */
export function createFallbackAdapter(config: {
  id: string;
  label: string;
  strategies: StoreAdapter[];
  enabled?: boolean;
}): StoreAdapter {
  return {
    id: config.id,
    label: config.label,
    enabled: config.enabled ?? true,

    async search(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
      const failures: string[] = [];

      for (const strategy of config.strategies) {
        try {
          const offers = await strategy.search(query, ctx);
          if (offers.length > 0) {
            ctx.log(`${config.label}: estrategia "${strategy.id}" devolvio ${offers.length}`);
            return offers;
          }
          failures.push(`${strategy.id} -> 0 resultados`);
        } catch (error) {
          failures.push(`${strategy.id} -> ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      throw new Error(`ninguna estrategia funciono. ${failures.join(' | ')}`);
    },
  };
}
