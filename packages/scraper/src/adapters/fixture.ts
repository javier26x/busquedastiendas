import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AdapterContext, RawOffer, StoreAdapter } from '../types.js';
import { matchesRules, normalizeText } from '../lib/text.js';
import { SEARCHES } from '../config/searches.js';

/**
 * Tienda simulada que lee `fixtures/offers.json`.
 *
 * Sirve para dos cosas: probar el pipeline completo sin salir a internet
 * (tests y CI) y poblar el panel con datos de ejemplo antes de la primera
 * corrida real. Nunca se activa por defecto.
 */
const FIXTURE_PATH = fileURLToPath(new URL('../../fixtures/offers.json', import.meta.url));

interface FixtureFile {
  offers: (RawOffer & { storeLabel?: string })[];
}

export const fixtureAdapter: StoreAdapter = {
  id: 'fixture',
  label: 'Datos de ejemplo',
  enabled: false,

  async search(query: string, ctx: AdapterContext): Promise<RawOffer[]> {
    const raw = await readFile(FIXTURE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as FixtureFile;

    // Devolvemos solo lo que encaja con la busqueda pedida, para imitar
    // el comportamiento de un buscador real.
    const search = SEARCHES.find((candidate) =>
      candidate.queries.some((q) => normalizeText(q) === normalizeText(query)),
    );

    const offers = parsed.offers.filter((offer) =>
      search ? matchesRules(offer.title, search.match) : true,
    );

    ctx.log('Fixture cargado', { query, total: offers.length });
    return offers.slice(0, ctx.limit);
  },
};
