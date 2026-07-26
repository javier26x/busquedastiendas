import type { ReactNode } from 'react';
import type { PricePoint } from '../types.js';
import { formatPrice } from '../lib/format.js';

const WIDTH = 560;
const HEIGHT = 160;
const PADDING = { top: 12, right: 12, bottom: 12, left: 12 };

/**
 * Grafico de la evolucion del precio.
 *
 * Se dibuja como escalera (no como linea recta entre puntos) porque el precio
 * se mantiene constante entre observaciones: interpolar sugeriria cambios
 * graduales que nunca ocurrieron.
 *
 * Va en SVG a mano para no sumar una libreria de graficos por un solo uso.
 */
export function Sparkline({ points }: { points: PricePoint[] }): ReactNode {
  if (points.length === 0) {
    return <p className="muted small">Todavia no hay historial de precios.</p>;
  }

  if (points.length === 1) {
    return (
      <p className="muted small">
        Un solo registro: {formatPrice(points[0]?.price)}. El grafico aparece cuando el precio
        cambie al menos una vez.
      </p>
    );
  }

  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // Un rango cero (precio plano) romperia la division; se usa 1 como piso.
  const range = max - min || 1;

  const innerW = WIDTH - PADDING.left - PADDING.right;
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;

  const x = (index: number): number =>
    PADDING.left + (index / (points.length - 1)) * innerW;
  const y = (price: number): number =>
    PADDING.top + innerH - ((price - min) / range) * innerH;

  // Escalera: horizontal hasta el siguiente punto, luego vertical.
  const segments: string[] = [`M ${x(0)} ${y(prices[0] ?? min)}`];
  for (let i = 1; i < points.length; i += 1) {
    const price = prices[i] ?? min;
    segments.push(`L ${x(i)} ${y(prices[i - 1] ?? min)}`);
    segments.push(`L ${x(i)} ${y(price)}`);
  }
  const path = segments.join(' ');
  const area = `${path} L ${x(points.length - 1)} ${PADDING.top + innerH} L ${x(0)} ${PADDING.top + innerH} Z`;

  return (
    <figure className="spark">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="spark__svg"
        role="img"
        aria-label={`Evolucion del precio entre ${formatPrice(min)} y ${formatPrice(max)}`}
        preserveAspectRatio="none"
      >
        <path d={area} className="spark__area" />
        <path d={path} className="spark__line" />
        {points.map((point, index) => (
          <circle
            key={`${point.capturedAt.getTime()}-${index}`}
            cx={x(index)}
            cy={y(point.price)}
            r={3}
            className={`spark__dot ${point.isOffer ? 'spark__dot--offer' : ''}`}
          />
        ))}
      </svg>

      <figcaption className="spark__caption">
        <span>Min {formatPrice(min)}</span>
        <span>Max {formatPrice(max)}</span>
      </figcaption>
    </figure>
  );
}
