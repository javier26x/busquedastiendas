import type { ReactNode } from 'react';
import type { Stats } from '../lib/sort.js';
import { formatPercent, formatPrice } from '../lib/format.js';

export function StatsBar({ stats }: { stats: Stats }): ReactNode {
  return (
    <section className="stats" aria-label="Resumen">
      <StatCard label="Productos" value={String(stats.total)} />
      <StatCard label="En oferta" value={String(stats.offers)} tone={stats.offers > 0 ? 'offer' : undefined} />
      <StatCard
        label="Bajaron de precio"
        value={String(stats.drops)}
        tone={stats.drops > 0 ? 'down' : undefined}
      />
      <StatCard
        label="Subieron de precio"
        value={String(stats.rises)}
        tone={stats.rises > 0 ? 'up' : undefined}
      />
      <StatCard
        label="En su minimo"
        value={String(stats.historicLows)}
        detail="precio mas bajo visto"
        tone={stats.historicLows > 0 ? 'low' : undefined}
      />
      <StatCard
        label="Mas barato"
        value={formatPrice(stats.cheapest?.price)}
        detail={stats.cheapest?.storeLabel}
      />
      <StatCard
        label="Mayor baja"
        value={stats.biggestDrop ? formatPercent(stats.biggestDrop.priceChangePct) : '—'}
        detail={stats.biggestDrop?.storeLabel}
        tone={stats.biggestDrop ? 'down' : undefined}
      />
    </section>
  );
}

function StatCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string | undefined;
  tone?: 'up' | 'down' | 'offer' | 'low' | undefined;
}): ReactNode {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={`stat__value ${tone ? `stat__value--${tone}` : ''}`}>{value}</span>
      {detail && <span className="stat__detail">{detail}</span>}
    </div>
  );
}
