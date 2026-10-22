/**
 * Original badge artwork (inline SVG, no assets): tenure gems in their tier colours, the
 * Early Member sprout, and the Space owner's crown. Unknown ids draw a neutral dot.
 */
import { useId } from 'react';

/** Light → dark stops of each tenure tier's gem. */
const TENURE: Record<string, [string, string]> = {
  'tenure-bronze': ['#f0b48a', '#9c5a32'],
  'tenure-silver': ['#f1f3f7', '#8f99aa'],
  'tenure-gold': ['#ffe58a', '#c98d12'],
  'tenure-platinum': ['#e4f6fa', '#78aebe'],
  'tenure-diamond': ['#c4f0ff', '#3594dc'],
  'tenure-emerald': ['#98f3c6', '#0f8f5a'],
  'tenure-ruby': ['#ffa3b5', '#bd1239'],
  'tenure-opal': ['#ffd9f4', '#7b86ff'],
};

function useGradientId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** A cut gem: a hexagon with a table facet and side facets. */
function Gem({ from, to, size }: { from: string; to: string; size: number }) {
  const gid = useGradientId('gem');
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <path d="M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9z" fill={`url(#${gid})`} />
      <path
        d="M12 2.5v5.2M20.5 7.5 16 10M3.5 7.5 8 10M8 10h8l-4 11.5zM8 10l4-2.3 4 2.3"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.55"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9z" fill="none" stroke={to} strokeWidth="1" />
    </svg>
  );
}

/** Early Member: a sprout in a brand-violet seal. */
function Sprout({ size }: { size: number }) {
  const gid = useGradientId('early');
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9d91ff" />
          <stop offset="1" stopColor="#5a48e8" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill={`url(#${gid})`} />
      <path d="M12 18v-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 12.5c0-3 2-4.8 5-4.8 0 3-2 4.8-5 4.8z" fill="#c6f6d5" />
      <path d="M12 13.5c0-2.4-1.6-3.9-4-3.9 0 2.4 1.6 3.9 4 3.9z" fill="#86efac" />
    </svg>
  );
}

/** Space owner: a crown. */
function Crown({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path
        d="M3.5 8.5 8 12l4-6.5 4 6.5 4.5-3.5-1.8 9.5H5.3z"
        fill="#f0b232"
        stroke="#b07a10"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M5.6 19.5h12.8" stroke="#b07a10" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function BadgeIcon({ id, size = 20 }: { id: string; size?: number }) {
  const tier = TENURE[id];
  if (tier) return <Gem from={tier[0]} to={tier[1]} size={size} />;
  if (id === 'early-member') return <Sprout size={size} />;
  if (id === 'space-owner') return <Crown size={size} />;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <circle cx="12" cy="12" r="8" fill="currentColor" opacity="0.5" />
    </svg>
  );
}
