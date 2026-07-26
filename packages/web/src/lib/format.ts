/** Formateo para es-CL. El peso chileno no usa decimales. */

const CLP = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

const DATE_TIME = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return CLP.format(value);
}

export function formatDateTime(date: Date | null | undefined): string {
  if (!date) return '—';
  return DATE_TIME.format(date);
}

/** Variacion con signo explicito: "-12,5%". */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`;
}

/** Diferencia absoluta con signo: "-$20.000". */
export function formatDelta(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '-';
  return `${sign}${CLP.format(Math.abs(value))}`;
}

/** "hace 3 horas", "hace 2 dias". */
export function formatRelative(date: Date | null | undefined, now: Date = new Date()): string {
  if (!date) return '—';

  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.round(diffMs / 60000);

  if (minutes < 1) return 'recien';
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;

  const days = Math.round(hours / 24);
  if (days < 30) return `hace ${days} ${days === 1 ? 'dia' : 'dias'}`;

  const months = Math.round(days / 30);
  return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
}

/** Un producto que no se ve hace mas de 48 h probablemente ya no esta listado. */
export function isStale(lastSeenAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastSeenAt.getTime() > 48 * 60 * 60 * 1000;
}
