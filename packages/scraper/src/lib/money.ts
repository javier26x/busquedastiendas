/**
 * Parseo de precios chilenos.
 *
 * El peso chileno no usa decimales y separa miles con punto: "$129.990".
 * Igual toleramos formatos con coma decimal porque algunas tiendas exponen
 * "129990,00" en sus APIs.
 */

/** Precio minimo/maximo plausible en CLP; fuera de rango se considera basura. */
const MIN_CLP = 100;
const MAX_CLP = 100_000_000;

/**
 * Extrae un entero en CLP desde texto libre.
 * Devuelve null si no hay un numero plausible.
 */
export function parseClp(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'number') {
    return sanitize(Math.round(raw));
  }

  // Nos quedamos solo con digitos y separadores.
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  const lastSep = Math.max(lastDot, lastComma);

  let digits: string;
  if (lastSep === -1) {
    digits = cleaned;
  } else {
    const decimals = cleaned.length - lastSep - 1;
    // Un separador final seguido de 1-2 digitos es decimal (ej "129990,00");
    // seguido de 3 es separador de miles (ej "129.990").
    if (decimals > 0 && decimals <= 2) {
      digits = cleaned.slice(0, lastSep).replace(/[.,]/g, '');
    } else {
      digits = cleaned.replace(/[.,]/g, '');
    }
  }

  if (!/^\d+$/.test(digits)) return null;
  return sanitize(Number.parseInt(digits, 10));
}

function sanitize(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (value < MIN_CLP || value > MAX_CLP) return null;
  return value;
}

/**
 * Descuento porcentual respecto al precio normal.
 * Devuelve null si no hay precio normal valido o si no hay rebaja.
 */
export function discountPercent(price: number, listPrice: number | null): number | null {
  if (listPrice === null || listPrice <= 0) return null;
  if (listPrice <= price) return null;
  return Math.round(((listPrice - price) / listPrice) * 100);
}

/** Variacion porcentual entre dos precios, redondeada a 2 decimales. */
export function changePercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}
