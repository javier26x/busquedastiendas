import type { MatchRules } from '../types.js';

/** Minusculas, sin tildes y con espacios colapsados. Base para comparar titulos. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convierte texto libre en un identificador seguro para claves de Firestore. */
export function slugify(input: string): string {
  return (
    normalizeText(input)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'x'
  );
}

/**
 * Decide si un titulo corresponde realmente a lo que buscamos.
 *
 * Los buscadores de las tiendas devuelven mucho ruido: "bodega de jardin"
 * en Chile trae bodegas de vino, servicios de bodegaje y estantes sueltos.
 * `requireAll` exige al menos un termino de cada grupo y `exclude` descarta.
 */
export function matchesRules(title: string, rules: MatchRules): boolean {
  const haystack = normalizeText(title);

  for (const term of rules.exclude) {
    if (haystack.includes(normalizeText(term))) return false;
  }

  return rules.requireAll.every((group) =>
    group.some((term) => haystack.includes(normalizeText(term))),
  );
}

/** Recorta un texto sin cortar palabras a la mitad. */
export function truncate(input: string, max = 180): string {
  const clean = input.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).replace(/\s+\S*$/, '')}...`;
}

/** Convierte una URL relativa en absoluta; devuelve null si no es utilizable. */
export function absoluteUrl(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}
