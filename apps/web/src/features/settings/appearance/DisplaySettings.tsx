/**
 * Settings ▸ Chats, the display controls: the gradient colour themes (and Custom from two
 * colours), Message display (Cozy / Compact, avatars in Compact), chat font scaling, zoom
 * level, UI density and "Sync across clients". Device prefs (stores/ui.ts) applied on <html> by
 * applyAppearance; the synced ones follow me across devices (stores/preferencesSync.ts).
 */
import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, CircleUserRound, MonitorSmartphone, Palette } from 'lucide-react';
import { ICON_STROKE_BOLD } from '@/components/icons';
import {
  APP_THEMES,
  APP_THEME_LABELS,
  customThemeVars,
  type AppTheme,
} from '@/features/appearance/appThemes';
import { Segmented } from '@/features/appearance/pickers';
import { ZOOM_LEVELS, nearestZoomIndex, zoomLabel } from '@/features/appearance/zoom';
import { MOD_KEY } from '@/features/conversation/composer/formatting/shortcuts';
import { cn } from '@/lib/cn';
import {
  CHAT_FONT_MAX_PX,
  CHAT_FONT_MIN_PX,
  THEME_COLORS,
  chatFontPx,
  nearestFontSize,
  themeVariant,
  useUi,
  type DevicePrefs,
  type MessageDisplay,
  type ThemeVariant,
  type UiDensity,
} from '@/stores/ui';
import { SwitchRow } from '../ui';

function setPref<K extends keyof DevicePrefs>(key: K, value: DevicePrefs[K]): void {
  useUi.getState().setPref(key, value);
}

// ---------------------------------------------------------------------------
// Colour themes
// ---------------------------------------------------------------------------

const THEME_IDS: AppTheme[] = ['default', ...APP_THEMES, 'custom'];

/** The plain palette's app background behind its surface (THEME_COLORS), for the Default tile. */
const PLAIN_APP: Record<ThemeVariant, string> = {
  light: '#e3e5e8',
  ash: '#1e1f22',
  dark: '#111113',
  onyx: '#000000',
};

function ThemeSwatch({
  id,
  selected,
  onSelect,
}: {
  id: AppTheme;
  selected: boolean;
  onSelect: () => void;
}) {
  const variant = useUi((s) => themeVariant(s.theme));
  const resolvedTheme = useUi((s) => s.resolvedTheme);
  const colors = useUi((s) => s.prefs.customThemeColors);
  const label = APP_THEME_LABELS[id];
  // Presets and Custom draw from index.css `[data-theme-swatch]`; Default from the palette.
  const style: CSSProperties | undefined =
    id === 'default'
      ? { backgroundColor: PLAIN_APP[variant] }
      : id === 'custom'
        ? (customThemeVars(colors, resolvedTheme) as CSSProperties)
        : undefined;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className="group flex min-w-0 flex-col items-center gap-1.5 outline-none"
    >
      <span
        data-theme-swatch={id === 'default' ? undefined : id}
        style={style}
        className={cn(
          'relative flex aspect-square w-full items-end justify-end overflow-hidden rounded-xl p-1.5 ring-2 transition-[transform,box-shadow] ring-inset group-active:scale-95',
          selected ? 'ring-brand' : 'ring-transparent group-hover:ring-line-strong',
          'group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-brand',
        )}
        aria-hidden
      >
        <span
          data-swatch-pane
          className="h-1/2 w-2/3 rounded-md shadow-sm"
          style={id === 'default' ? { backgroundColor: THEME_COLORS[variant] } : undefined}
        />
        {id === 'custom' ? (
          <Palette size={16} className="absolute top-1.5 left-1.5 text-fg/80" aria-hidden />
        ) : null}
        {selected ? (
          <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-brand text-on-brand shadow">
            <Check size={12} strokeWidth={ICON_STROKE_BOLD} aria-hidden />
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          'max-w-full truncate text-[12px]',
          selected ? 'font-semibold text-fg' : 'text-muted',
        )}
      >
        {label}
      </span>
    </button>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const id = useId();
  return (
    <span className="flex items-center gap-2.5">
      <input
        id={id}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        className="size-9 shrink-0 cursor-pointer appearance-none rounded-full border border-line-strong bg-transparent p-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0"
      />
      <label htmlFor={id} className="cursor-pointer text-[14px] text-fg">
        {label}
      </label>
      <span className="font-mono text-[13px] text-muted" aria-hidden>
        {value}
      </span>
    </span>
  );
}

/** The colour themes over Light / Dark: Default, the presets and Custom (two colours). */
export function AppThemePicker() {
  const appTheme = useUi((s) => s.prefs.appTheme);
  const colors = useUi((s) => s.prefs.customThemeColors);
  const labelId = useId();
  const pick = (i: 0 | 1, hex: string) =>
    setPref('customThemeColors', i === 0 ? [hex, colors[1]] : [colors[0], hex]);
  return (
    <div className="flex flex-col gap-3 px-4 pb-4 lg:px-5">
      <div className="flex flex-col gap-0.5">
        <span id={labelId} className="text-[16px] leading-snug text-fg">
          Colour
        </span>
        <span className="text-[13.5px] leading-snug text-muted">
          A gradient behind the app and panes tinted to match, in light and dark
        </span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="grid grid-cols-5 gap-3 sm:grid-cols-10"
      >
        {THEME_IDS.map((id) => (
          <ThemeSwatch
            key={id}
            id={id}
            selected={appTheme === id}
            onSelect={() => setPref('appTheme', id)}
          />
        ))}
      </div>
      {appTheme === 'custom' ? (
        <div className="flex flex-wrap gap-x-6 gap-y-3" data-testid="custom-theme-colors">
          <ColorInput label="First colour" value={colors[0]} onChange={(hex) => pick(0, hex)} />
          <ColorInput label="Second colour" value={colors[1]} onChange={(hex) => pick(1, hex)} />
        </div>
      ) : null}
    </div>
  );
}

/** "Sync across clients": the theme, display and chat settings follow me to my devices. */
export function SyncPreferencesRow() {
  const on = useUi((s) => s.prefs.syncPreferences);
  return (
    <SwitchRow
      icon={MonitorSmartphone}
      title="Sync across clients"
      description="Your theme, display, accessibility and chat settings follow you to your other devices. Off: this device keeps its own."
      checked={on}
      onChange={(v) => setPref('syncPreferences', v)}
    />
  );
}

// ---------------------------------------------------------------------------
// Message display
// ---------------------------------------------------------------------------

const SAMPLE = [
  { name: 'Ava', color: 'bg-brand/70', time: '3:14 PM', text: 'Are we still on for tonight?' },
  { name: 'Leo', color: 'bg-success/70', time: '3:15 PM', text: 'Yes! Eight o’clock.' },
];

function CozyPreview() {
  return (
    <span className="flex flex-col gap-2 text-[12px] leading-snug" aria-hidden>
      {SAMPLE.map((s) => (
        <span key={s.name} className="flex items-start gap-2">
          <span className={cn('size-6 shrink-0 rounded-full', s.color)} />
          <span className="flex min-w-0 flex-col">
            <span className="flex items-baseline gap-1.5">
              <span className="font-semibold text-fg">{s.name}</span>
              <span className="text-[10px] text-muted">Today at {s.time}</span>
            </span>
            <span className="truncate text-fg/90">{s.text}</span>
          </span>
        </span>
      ))}
    </span>
  );
}

function CompactPreview({ avatars }: { avatars: boolean }) {
  return (
    <span className="flex flex-col gap-1 text-[12px] leading-snug" aria-hidden>
      {SAMPLE.map((s) => (
        <span key={s.name} className="flex min-w-0 items-center gap-1.5">
          <span className="w-11 shrink-0 text-right text-[10px] text-muted tabular-nums">
            {s.time}
          </span>
          {avatars ? <span className={cn('size-3.5 shrink-0 rounded-full', s.color)} /> : null}
          <span className="font-semibold text-fg">{s.name}</span>
          <span className="truncate text-fg/90">{s.text}</span>
        </span>
      ))}
    </span>
  );
}

function DisplayOption({
  title,
  description,
  selected,
  onSelect,
  children,
}: {
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      onClick={onSelect}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-xl bg-surface p-3 text-left ring-2 transition-colors outline-none ring-inset',
        selected ? 'ring-brand' : 'ring-transparent hover:ring-line-strong',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
      )}
    >
      <span className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2',
            selected ? 'border-brand bg-brand text-on-brand' : 'border-line-strong',
          )}
          aria-hidden
        >
          {selected ? <Check size={12} strokeWidth={ICON_STROKE_BOLD} /> : null}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span id={`${id}-title`} className="text-[15px] font-semibold text-fg">
            {title}
          </span>
          <span id={`${id}-desc`} className="text-[13px] leading-snug text-muted">
            {description}
          </span>
        </span>
      </span>
      <span className="block rounded-lg bg-surface-2 p-2.5">{children}</span>
    </button>
  );
}

/** Cozy or Compact rows, and avatars in Compact. Compact needs rows: it switches bubbles to Cozy. */
export function MessageDisplayPicker() {
  const display = useUi((s) => s.prefs.messageDisplay);
  const avatars = useUi((s) => s.prefs.compactShowAvatars);
  const rows = useUi((s) => s.prefs.bubbleStyle === 'cozy');
  const choose = (value: MessageDisplay) =>
    useUi
      .getState()
      .setPrefs(
        value === 'compact' && !rows
          ? { messageDisplay: value, bubbleStyle: 'cozy' }
          : { messageDisplay: value },
      );
  return (
    <>
      <div
        role="radiogroup"
        aria-label="Message display"
        className="grid gap-3 px-3 pt-3 pb-2 sm:grid-cols-2 lg:px-4"
      >
        <DisplayOption
          title="Cozy"
          description="Roomy rows with an avatar and name over each group"
          selected={display === 'cozy'}
          onSelect={() => choose('cozy')}
        >
          <CozyPreview />
        </DisplayOption>
        <DisplayOption
          title="Compact"
          description="One line per message, so more fit on screen"
          selected={display === 'compact'}
          onSelect={() => choose('compact')}
        >
          <CompactPreview avatars={avatars} />
        </DisplayOption>
      </div>
      <SwitchRow
        icon={CircleUserRound}
        title="Show avatars in Compact mode"
        checked={avatars}
        disabled={display !== 'compact'}
        onChange={(v) => setPref('compactShowAvatars', v)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Chat font scaling, zoom, density
// ---------------------------------------------------------------------------

const FONT_TICKS = [12, 14, 15, 16, 18, 20, 24];

/** A labelled slider row: name and value on top, the range under it, a note below. */
function SliderBlock({
  label,
  value,
  note,
  children,
  inputId,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  children: ReactNode;
  inputId: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg px-3 py-3 lg:px-4">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={inputId} className="text-[16px] text-fg">
          {label}
        </label>
        <span className="text-[14px] text-muted tabular-nums" aria-hidden>
          {value}
        </span>
      </div>
      {children}
      {note ? <p className="text-[13.5px] leading-snug text-muted">{note}</p> : null}
    </div>
  );
}

/** 12-24 px chat text with a live sample (also keeps the older 3-step `fontSize` close). */
export function ChatFontScaling() {
  const px = useUi((s) => chatFontPx(s.prefs));
  const id = useId();
  return (
    <>
      <div
        className="mx-3 mt-3 flex items-start gap-3 rounded-xl bg-surface px-3 py-2.5 lg:mx-4"
        data-testid="font-sample"
        aria-hidden
      >
        <span className="mt-0.5 size-8 shrink-0 rounded-full bg-brand/70" />
        <span className="flex min-w-0 flex-col">
          <span className="flex items-baseline gap-2">
            <span className="text-chat font-semibold text-fg">Ava</span>
            <span className="text-[11px] text-muted">Today at 3:14 PM</span>
          </span>
          <span className="text-chat leading-[1.38] text-fg">
            Pick the size that is easiest for you to read.
          </span>
        </span>
      </div>
      <SliderBlock label="Chat font scaling" value={`${px}px`} inputId={id}>
        <input
          id={id}
          type="range"
          min={CHAT_FONT_MIN_PX}
          max={CHAT_FONT_MAX_PX}
          step={1}
          list={`${id}-ticks`}
          value={px}
          aria-valuetext={`${px} pixels`}
          onChange={(e) => {
            const v = Number(e.target.value);
            useUi.getState().setPrefs({ chatFontPx: v, fontSize: nearestFontSize(v) });
          }}
          className="h-1.5 w-full cursor-pointer accent-[var(--brand)]"
        />
        <datalist id={`${id}-ticks`}>
          {FONT_TICKS.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <div className="flex justify-between text-[12px] text-subtle" aria-hidden>
          <span>{CHAT_FONT_MIN_PX}px</span>
          <span>{CHAT_FONT_MAX_PX}px</span>
        </div>
      </SliderBlock>
    </>
  );
}

/**
 * 50-200% in the browser's steps; Ctrl / Cmd + = - 0 do the same anywhere (features/appearance/
 * zoom.ts). A drag applies on release: zooming rescales the slider under the pointer.
 */
export function ZoomLevel() {
  const zoom = useUi((s) => s.prefs.zoom);
  const id = useId();
  const dragging = useRef(false);
  const [draft, setDraft] = useState<number | null>(null);
  const index = draft ?? nearestZoomIndex(zoom);
  const level = ZOOM_LEVELS[index] ?? 1;
  const label = zoomLabel(level);
  const commit = () => {
    dragging.current = false;
    if (draft !== null) setPref('zoom', ZOOM_LEVELS[draft] ?? 1);
    setDraft(null);
  };
  return (
    <SliderBlock
      label="Zoom level"
      value={label}
      inputId={id}
      note={`${MOD_KEY} + = and ${MOD_KEY} + - zoom in and out, ${MOD_KEY} + 0 goes back to 100%.`}
    >
      <input
        id={id}
        type="range"
        min={0}
        max={ZOOM_LEVELS.length - 1}
        step={1}
        value={index}
        aria-valuetext={label}
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={commit}
        onPointerCancel={commit}
        onLostPointerCapture={commit}
        onBlur={commit}
        onChange={(e) => {
          const i = Number(e.target.value);
          if (dragging.current) setDraft(i);
          else setPref('zoom', ZOOM_LEVELS[i] ?? 1);
        }}
        className="h-1.5 w-full cursor-pointer accent-[var(--brand)]"
      />
      <div className="flex justify-between text-[12px] text-subtle" aria-hidden>
        <span>{zoomLabel(ZOOM_LEVELS[0])}</span>
        <span>{zoomLabel(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!)}</span>
      </div>
    </SliderBlock>
  );
}

const DENSITIES: { value: UiDensity; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'default', label: 'Default' },
  { value: 'spacious', label: 'Spacious' },
];

/** Spacing of the channel, DM and member lists and between message groups. */
export function UiDensityPicker() {
  const density = useUi((s) => s.prefs.uiDensity);
  return (
    <Segmented
      aria-label="UI density"
      value={density}
      onChange={(v) => setPref('uiDensity', v)}
      className="mx-4 my-4 lg:mx-5"
      options={DENSITIES}
    />
  );
}
