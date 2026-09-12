import type { Product } from '../types.js';
import { isAtHistoricLow } from './sort.js';

/**
 * Exporta lo que se esta viendo a CSV.
 *
 * El panel muestra una tabla y nada mas; en cuanto uno quiere comparar
 * ofertas fuera de aqui, mandarselas a alguien o guardarse el estado de un
 * Cyber, necesita sacar los datos. Se exporta la seleccion visible, con sus
 * filtros y su orden aplicados, porque es lo que el usuario acaba de armar.
 */

const COLUMNS: { header: string; value: (product: Product) => string | number | null }[] = [
  { header: 'Tienda', value: (p) => p.storeLabel },
  { header: 'Producto', value: (p) => p.title },
  { header: 'Marca', value: (p) => p.brand },
  { header: 'Precio', value: (p) => p.price },
  { header: 'Precio normal', value: (p) => p.listPrice },
  { header: 'Descuento %', value: (p) => p.discountPct },
  { header: 'En oferta', value: (p) => (p.isOffer ? 'si' : 'no') },
  { header: 'Precio anterior', value: (p) => p.previousPrice },
  { header: 'Variacion', value: (p) => p.priceChange },
  { header: 'Variacion %', value: (p) => p.priceChangePct },
  { header: 'Minimo historico', value: (p) => p.minPrice },
  { header: 'Maximo historico', value: (p) => p.maxPrice },
  { header: 'En su minimo', value: (p) => (isAtHistoricLow(p) ? 'si' : 'no') },
  { header: 'Disponible', value: (p) => (p.available ? 'si' : 'no') },
  { header: 'Visto', value: (p) => p.lastSeenAt.toISOString() },
  { header: 'URL', value: (p) => p.url },
];

/**
 * Separador de columnas.
 *
 * Punto y coma y no coma: Excel en español espera eso, y con coma abre todo
 * el CSV apilado en una sola columna. Es el detalle que decide si el archivo
 * sirve al abrirlo o hay que pelearse con el asistente de importacion.
 */
const DELIMITER = ';';

/** Marca de orden de bytes. Sin ella Excel lee el archivo como Latin-1. */
const BOM = '\ufeff';

export function toCsv(products: Product[]): string {
  const rows = [
    COLUMNS.map((column) => column.header),
    ...products.map((product) => COLUMNS.map((column) => format(column.value(product)))),
  ];

  // Fin de linea de Windows, que es donde se va a abrir.
  return rows.map((row) => row.map(escape).join(DELIMITER)).join('\r\n');
}

function format(value: string | number | null): string {
  if (value === null) return '';
  // Decimales con coma, que es lo que entiende Excel en español; los precios
  // en pesos son enteros, pero la variacion porcentual no.
  if (typeof value === 'number') return String(value).replace('.', ',');
  return value;
}

/**
 * Entrecomilla si hace falta.
 *
 * Un titulo con punto y coma, comillas o salto de linea rompe las columnas
 * del resto de la fila si viaja crudo.
 */
function escape(value: string): string {
  if (!/[";\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** Nombre con fecha, para que dos exportaciones no se pisen en Descargas. */
export function csvFilename(searchLabel: string | null, now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const slug = (searchLabel ?? 'todas')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `precios-${slug || 'todas'}-${date}.csv`;
}

/** Dispara la descarga en el navegador. */
export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  // Sin esto el blob queda retenido hasta que se cierre la pestaña.
  URL.revokeObjectURL(url);
}
