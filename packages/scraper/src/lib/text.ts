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

/** Largo maximo del slug. Firestore admite mas, pero conviene una clave legible. */
const SLUG_MAX = 120;
/** Sufijo de desempate: guion + hash de 7 caracteres. */
const HASH_LEN = 8;

/** Convierte texto libre en un identificador seguro para claves de Firestore. */
export function slugify(input: string): string {
  const slug = normalizeText(input)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) return 'x';
  if (slug.length <= SLUG_MAX) return slug;

  // Recortar a secas hace colisionar dos URLs largas con el mismo prefijo
  // (pasa en IKEA), y entonces dos productos distintos comparten documento y
  // se pisan el precio inventando variaciones. El sufijo depende del texto
  // completo, asi que solo coinciden si de verdad son el mismo.
  return `${slug.slice(0, SLUG_MAX - HASH_LEN)}-${shortHash(slug)}`;
}

/** FNV-1a de 32 bits en base36. Alcanza de sobra para desempatar slugs. */
function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(HASH_LEN - 1, '0');
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
