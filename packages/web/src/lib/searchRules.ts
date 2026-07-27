/**
 * Reglas de relevancia de una busqueda, desde el punto de vista de la web.
 *
 * El scraper filtra los resultados de cada tienda con estas reglas, porque
 * los buscadores devuelven mucho ruido. Pedirle al usuario que las escriba a
 * mano seria hostil, asi que se derivan del nombre de la busqueda y quedan
 * editables para quien quiera afinarlas.
 *
 * Logica pura y sin dependencias, para poder testearla (ver test/searchRules.test.ts).
 */

export interface MatchRules {
  /** El titulo debe contener al menos un termino de cada grupo. */
  requireAll: string[][];
  /** Si el titulo contiene alguno de estos, se descarta. */
  exclude: string[];
}

export interface SearchDraft {
  id: string;
  label: string;
  queries: string[];
  match: MatchRules;
  enabled: boolean;
}

/** Palabras sin valor discriminante para filtrar titulos. */
const STOPWORDS = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'un',
  'una',
  'unos',
  'unas',
  'para',
  'con',
  'sin',
  'y',
  'o',
  'en',
  'por',
  'a',
  'al',
  'que',
]);

export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Recorta el plural mas comun del espanol.
 *
 * Con la raiz, "panal" encuentra tanto "panales" como "panal"; con la palabra
 * completa en plural se perderian los titulos en singular.
 */
export function stem(word: string): string {
  const clean = normalize(word);
  if (clean.length <= 4) return clean;
  if (clean.endsWith('ces')) return `${clean.slice(0, -3)}z`; // lapices -> lapiz
  if (clean.endsWith('es')) return clean.slice(0, -2);
  if (clean.endsWith('s')) return clean.slice(0, -1);
  return clean;
}

/** Palabras utiles de un texto, ya normalizadas y sin repetir. */
export function significantWords(text: string): string[] {
  const words = normalize(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));

  return [...new Set(words)];
}

/**
 * Deriva reglas razonables a partir del nombre de la busqueda.
 *
 * Cada palabra significativa se vuelve un requisito propio: para "pañales
 * talla g" el titulo tendra que mencionar la raiz de las tres. Es un punto
 * de partida conservador que el usuario puede relajar.
 */
export function deriveMatchRules(label: string): MatchRules {
  const words = significantWords(label);
  if (words.length === 0) return { requireAll: [], exclude: [] };

  return {
    requireAll: words.map((word) => [stem(word)]),
    exclude: [],
  };
}

/** Identificador estable y legible para el documento en Firestore. */
export function toSearchId(label: string): string {
  const slug = normalize(label)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return slug || `busqueda-${Date.now()}`;
}

/**
 * Formato de texto de las reglas para el formulario.
 * Una linea por requisito; las palabras de una linea son alternativas.
 */
export function rulesToText(rules: MatchRules): string {
  return rules.requireAll.map((group) => group.join(', ')).join('\n');
}

export function textToRules(text: string, excludeText: string): MatchRules {
  const requireAll = text
    .split('\n')
    .map((line) =>
      line
        .split(',')
        .map((word) => word.trim())
        .filter(Boolean),
    )
    .filter((group) => group.length > 0);

  const exclude = excludeText
    .split(/[,\n]/)
    .map((word) => word.trim())
    .filter(Boolean);

  return { requireAll, exclude };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Se valida en la web para dar mensajes utiles; las reglas de Firestore repiten el control. */
export function validateDraft(draft: SearchDraft): ValidationResult {
  const errors: string[] = [];

  if (!draft.label.trim()) errors.push('Ponle un nombre a la busqueda.');
  if (draft.label.length > 60) errors.push('El nombre no puede pasar de 60 caracteres.');

  if (draft.queries.length === 0) {
    errors.push('Agrega al menos un termino de busqueda.');
  }
  if (draft.queries.length > 10) {
    errors.push('Maximo 10 terminos: cada uno se consulta en todas las tiendas.');
  }
  if (draft.queries.some((query) => query.length > 80)) {
    errors.push('Algun termino es demasiado largo.');
  }

  if (draft.match.requireAll.length > 10) {
    errors.push('Maximo 10 lineas de palabras obligatorias.');
  }
  if (draft.match.exclude.length > 30) {
    errors.push('Maximo 30 palabras excluidas.');
  }

  return { ok: errors.length === 0, errors };
}

/** Convierte texto multilinea en la lista de terminos a consultar. */
export function parseQueries(text: string): string[] {
  return [
    ...new Set(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}
