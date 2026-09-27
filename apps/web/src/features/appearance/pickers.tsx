/**
 * Appearance pickers shared by the ChatThemeSheet and Settings → Chats: preset swatches,
 * bubble style / animation segments, the accent colour (curated swatches + hex input),
 * wallpaper tiles (colours, animated presets, my upload) and the dim/blur sliders.
 * Discord-like chrome: rounded tiles and pills on the surface, no divider lines.
 */
import { useId, useRef, type ReactNode } from 'react';
import { Check, ImagePlus, Sparkles } from 'lucide-react';
import {
  BUBBLE_STYLES,
  CHAT_THEME_PRESETS,
  MESSAGE_ANIMATIONS,
  WALLPAPER_PRESETS,
  type BubbleStyle,
  type ChatThemePreset,
  type ChatWallpaperAttachment,
  type MessageAnimation,
  type WallpaperPresetId,
} from '@enbox/shared';
import { ICON_STROKE_BOLD } from '@/components/icons';
import { Spinner } from '@/components/ui';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ResolvedTheme } from '@/stores/ui';
import { CHAT_THEME_PRESET_DEFS, WALLPAPER_PRESET_DEFS, isAccentHex } from './presets';
import { WALLPAPER_ACCEPT } from './wallpaperUpload';

// ---------------------------------------------------------------------------
// Segmented pill (bubble style, animation, scope)
// ---------------------------------------------------------------------------

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  ...aria
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  className?: string;
  'aria-label': string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={aria['aria-label']}
      className={cn('flex rounded-full bg-surface-2 p-1', className)}
    >
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-9 min-w-0 flex-1 rounded-full px-2 text-[14px] font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-brand',
              selected ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export const BUBBLE_STYLE_LABELS: Record<BubbleStyle, string> = {
  classic: 'Classic',
  rounded: 'Rounded',
  minimal: 'Minimal',
  cozy: 'Cozy',
};

export const MESSAGE_ANIMATION_LABELS: Record<MessageAnimation, string> = {
  none: 'None',
  fade: 'Fade',
  slide: 'Slide',
  pop: 'Pop',
};

export function BubbleStylePicker({
  value,
  onChange,
  className,
}: {
  value: BubbleStyle;
  onChange: (value: BubbleStyle) => void;
  className?: string;
}) {
  return (
    <Segmented
      aria-label="Bubble style"
      value={value}
      onChange={onChange}
      className={className}
      options={BUBBLE_STYLES.map((s) => ({ value: s, label: BUBBLE_STYLE_LABELS[s] }))}
    />
  );
}

export function AnimationPicker({
  value,
  onChange,
  className,
}: {
  value: MessageAnimation;
  onChange: (value: MessageAnimation) => void;
  className?: string;
}) {
  return (
    <Segmented
      aria-label="Message animation"
      value={value}
      onChange={onChange}
      className={className}
      options={MESSAGE_ANIMATIONS.map((a) => ({ value: a, label: MESSAGE_ANIMATION_LABELS[a] }))}
    />
  );
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function Tile({
  selected,
  label,
  onClick,
  children,
  className,
  title,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      className="group flex min-w-0 flex-col items-center gap-1.5 outline-none"
    >
      <span
        className={cn(
          'relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl ring-2 transition-[transform,box-shadow] ring-inset group-active:scale-95',
          selected ? 'ring-brand' : 'ring-transparent group-hover:ring-line-strong',
          'group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-brand',
          className,
        )}
      >
        {children}
        {selected ? (
          <span className="absolute right-1 bottom-1 flex size-5 items-center justify-center rounded-full bg-brand text-on-brand shadow">
            <Check size={12} strokeWidth={ICON_STROKE_BOLD} aria-hidden />
          </span>
        ) : null}
      </span>
      <span
        className={cn('truncate text-[12px]', selected ? 'font-semibold text-fg' : 'text-muted')}
      >
        {label}
      </span>
    </button>
  );
}

/** Theme preset swatches: two mini bubbles on the preset's wallpaper colour. */
export function PresetGrid({
  value,
  onChange,
  resolvedTheme,
  className,
}: {
  value: ChatThemePreset | null;
  onChange: (value: ChatThemePreset) => void;
  resolvedTheme: ResolvedTheme;
  className?: string;
}) {
  const dark = resolvedTheme === 'dark';
  return (
    <div
      role="radiogroup"
      aria-label="Chat theme"
      className={cn('grid grid-cols-4 gap-3 sm:grid-cols-8', className)}
    >
      {CHAT_THEME_PRESETS.map((id) => {
        const def = CHAT_THEME_PRESET_DEFS[id];
        const v = def[resolvedTheme];
        const wallpaper = v?.['--wallpaper'] ?? (dark ? '#0d0d13' : '#efedf5');
        const out = v?.['--bubble-out'] ?? (dark ? '#3b3192' : '#e7e2ff');
        const inn = v?.['--bubble-in'] ?? (dark ? '#1f1f29' : '#ffffff');
        return (
          <Tile key={id} selected={value === id} label={def.label} onClick={() => onChange(id)}>
            <span
              className="flex size-full flex-col justify-center gap-1 p-2"
              style={{ backgroundColor: wallpaper }}
            >
              <span
                className="h-2.5 w-3/5 self-start rounded-md"
                style={{ backgroundColor: inn }}
              />
              <span className="h-2.5 w-3/5 self-end rounded-md" style={{ backgroundColor: out }} />
            </span>
          </Tile>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accent
// ---------------------------------------------------------------------------

/** Curated accents that pass `contrastOk` in the mode they are offered for. */
export const ACCENT_SWATCHES: Record<ResolvedTheme, string[]> = {
  light: ['#e7e2ff', '#cfe8ff', '#d4f5e2', '#ffe4c7', '#ffd6e2', '#fff3b8', '#e2e8f0', '#e5f7ff'],
  dark: ['#3b3192', '#0f4a63', '#17492c', '#6a2f14', '#5f2440', '#5a4a10', '#33333b', '#1c3a5c'],
};

export function AccentPicker({
  value,
  onChange,
  resolvedTheme,
  error,
  className,
}: {
  /** Canonical hex or null (= the preset's own). */
  value: string | null;
  /** Called with the raw input; the caller normalises and validates. */
  onChange: (value: string | null) => void;
  resolvedTheme: ResolvedTheme;
  error?: string | null;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          aria-label="Preset colour"
          title="Preset colour"
          onClick={() => onChange(null)}
          className={cn(
            'flex h-9 items-center rounded-full px-3 text-[13px] font-medium ring-2 transition-colors ring-inset',
            value === null
              ? 'bg-brand-soft text-brand-ink ring-brand'
              : 'bg-surface-2 text-muted ring-transparent hover:text-fg',
          )}
        >
          Auto
        </button>
        {ACCENT_SWATCHES[resolvedTheme].map((hex) => {
          const selected = value === hex;
          return (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={hex}
              title={hex}
              onClick={() => onChange(hex)}
              className={cn(
                'flex size-9 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-surface transition-transform active:scale-95',
                selected ? 'ring-brand' : 'ring-transparent hover:ring-line-strong',
              )}
              style={{ backgroundColor: hex }}
            >
              {selected ? (
                <Check size={14} strokeWidth={ICON_STROKE_BOLD} className="text-fg" aria-hidden />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <span
          className="size-9 shrink-0 rounded-full border border-line"
          style={{ backgroundColor: value && isAccentHex(value) ? value : 'transparent' }}
          aria-hidden
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={id} className="sr-only">
            Custom accent (hex)
          </label>
          <input
            id={id}
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="#rrggbb"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            className={cn(
              'h-10 w-full rounded-xl border bg-surface-2 px-3 font-mono text-[14px] text-fg outline-none focus:ring-2',
              error
                ? 'border-danger focus:ring-danger/30'
                : 'border-transparent focus:ring-brand/30',
            )}
          />
          {error ? (
            <span id={`${id}-error`} role="alert" className="text-[12.5px] text-danger">
              {error}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wallpaper
// ---------------------------------------------------------------------------

export type WallpaperChoice = WallpaperPresetId | 'media';

export function WallpaperGrid({
  value,
  onChange,
  resolvedTheme,
  media,
  onUpload,
  uploading,
  className,
}: {
  value: WallpaperChoice | null;
  onChange: (value: WallpaperChoice) => void;
  resolvedTheme: ResolvedTheme;
  /** My upload (private scope): shown as a tile. */
  media?: ChatWallpaperAttachment | null;
  /** Offer "Upload" (private scope only). */
  onUpload?: (file: File) => void;
  uploading?: boolean;
  className?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div
      role="radiogroup"
      aria-label="Wallpaper"
      className={cn('grid grid-cols-4 gap-3 sm:grid-cols-6', className)}
    >
      {WALLPAPER_PRESETS.map((id) => {
        const def = WALLPAPER_PRESET_DEFS[id];
        return (
          <Tile
            key={id}
            selected={value === id}
            label={def.label}
            title={def.animated ? `${def.label} (animated)` : def.label}
            onClick={() => onChange(id)}
          >
            <span className="size-full" style={{ backgroundColor: def[resolvedTheme] }} />
            {def.animated ? (
              <span className="absolute top-1 left-1 flex size-5 items-center justify-center rounded-full bg-surface/85 text-brand-ink">
                <Sparkles size={12} aria-hidden />
              </span>
            ) : null}
          </Tile>
        );
      })}
      {media ? (
        <Tile
          selected={value === 'media'}
          label="My photo"
          onClick={() => onChange('media')}
          className="bg-surface-2"
        >
          <img
            src={mediaUrl(media.thumbnailUrl ?? media.url)}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
        </Tile>
      ) : null}
      {onUpload ? (
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label="Upload a photo, GIF or video"
            className="flex aspect-square w-full items-center justify-center rounded-xl border-2 border-dashed border-line-strong text-muted transition-colors outline-none hover:border-brand hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
          >
            {uploading ? (
              <Spinner size={20} label="Uploading" />
            ) : (
              <ImagePlus size={22} aria-hidden />
            )}
          </button>
          <span className="truncate text-[12px] text-muted">Upload</span>
          <input
            ref={fileRef}
            type="file"
            accept={WALLPAPER_ACCEPT}
            className="hidden"
            data-testid="wallpaper-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onUpload(file);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sliders
// ---------------------------------------------------------------------------

export function SliderRow({
  label,
  value,
  min = 0,
  max,
  step = 1,
  unit,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('flex items-center gap-3 text-[14px] text-fg', className)}>
      <span className="w-14 shrink-0">{label}</span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--brand)] disabled:cursor-default disabled:opacity-50"
      />
      <span className="w-12 shrink-0 text-right text-[13px] tabular-nums text-muted">
        {value}
        {unit}
      </span>
    </label>
  );
}
