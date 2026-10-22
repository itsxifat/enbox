import { Pipette } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Known-good colours (the avatar fallback palette plus brights for name styles). */
export const THEME_PRESETS = [
  '#6d5dfc',
  '#0e7fc0',
  '#0f8a6a',
  '#c2410c',
  '#be185d',
  '#7c3aed',
  '#0f766e',
  '#b45309',
  '#1e1f22',
];

export const NAME_COLOR_PRESETS = [
  '#f2f3f5',
  '#8e80fd',
  '#38bdf8',
  '#4ade80',
  '#facc15',
  '#fb923c',
  '#f43f5e',
  '#f472b6',
];

export interface ColorPickerProps {
  label: string;
  /** Lowercase `#rrggbb`, or null for the default. */
  value: string | null;
  onChange: (value: string) => void;
  /** Colour shown (and seeded into the native picker) while `value` is null. */
  fallback?: string;
  presets?: readonly string[];
  className?: string;
}

/**
 * One colour: a big swatch that is the native colour input (so it opens the system picker)
 * and a row of preset swatches. Native pickers always yield a valid lowercase `#rrggbb`.
 */
export function ColorPicker({
  label,
  value,
  onChange,
  fallback = '#6d5dfc',
  presets = THEME_PRESETS,
  className,
}: ColorPickerProps) {
  const shown = value ?? fallback;
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <span className="text-[12px] font-semibold text-muted">{label}</span>
      <div className="flex items-center gap-3">
        <label
          className="relative flex h-12 w-16 shrink-0 cursor-pointer items-end justify-end overflow-hidden rounded-xl p-1 ring-1 ring-line-strong ring-inset focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand"
          style={{ backgroundColor: shown }}
        >
          <input
            type="color"
            aria-label={label}
            value={shown}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
          <Pipette size={14} className="pointer-events-none text-white drop-shadow" aria-hidden />
        </label>
        <div
          className="flex min-w-0 flex-wrap gap-1.5"
          role="group"
          aria-label={`${label} presets`}
        >
          {presets.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={value === c}
              onClick={() => onChange(c)}
              className={cn(
                'size-6 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                value === c
                  ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface'
                  : 'ring-1 ring-black/15 ring-inset',
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
      <span className="text-[12px] text-subtle">{value ?? 'Default'}</span>
    </div>
  );
}
