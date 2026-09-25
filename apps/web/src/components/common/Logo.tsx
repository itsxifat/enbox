import { useId } from 'react';
import { cn } from '@/lib/cn';

/** The Enbox mark (chat bubble with an "e"). Same artwork as public/icons/icon.svg. */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  const gid = `enbox-logo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8B7DFF" />
          <stop offset="1" stopColor="#5A48E8" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#${gid})`} />
      <path
        d="M256 108c-89 0-160 62-160 142 0 42 20 80 52 106l-14 62 66-31c17 5 36 7 56 7 89 0 160-62 160-144S345 108 256 108z"
        fill="#fff"
      />
      <path
        d="M190 252h132a66 66 0 1 0-19 46"
        fill="none"
        stroke="#6D5DFC"
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mark + wordmark. */
export function Logo({
  size = 32,
  className,
  wordmarkClassName,
}: {
  size?: number;
  className?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      <span className={cn('text-xl font-bold tracking-tight text-fg', wordmarkClassName)}>
        Enbox
      </span>
    </span>
  );
}
