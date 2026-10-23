import { useMemo } from 'react';
import { encode } from 'uqr';
import { cn } from '@/lib/cn';

/**
 * A QR code as an SVG: uqr with error correction M and the standard 4-module quiet zone, one
 * path of horizontal runs. Always black modules on white, whatever the theme: phone cameras
 * need the contrast.
 */
export function QrCode({
  value,
  label,
  size = 176,
  className,
}: {
  value: string;
  /** Accessible name (the image itself means nothing to a screen reader). */
  label: string;
  size?: number;
  className?: string;
}) {
  const { path, modules } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 4 });
    let d = '';
    qr.data.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (!row[x]) continue;
        let run = 1;
        while (row[x + run]) run++;
        d += `M${x} ${y}h${run}v1h-${run}z`;
        x += run - 1;
      }
    });
    return { path: d, modules: qr.size };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${modules} ${modules}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cn('block', className)}
    >
      <rect width={modules} height={modules} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
