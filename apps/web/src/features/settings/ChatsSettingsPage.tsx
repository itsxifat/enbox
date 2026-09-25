import { Check, CornerDownLeft, Sparkles } from 'lucide-react';
import { ICON_STROKE_BOLD, DoubleTickIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import {
  FONT_SIZES,
  WALLPAPERS,
  useUi,
  type FontSize,
  type ThemePref,
  type WallpaperId,
} from '@/stores/ui';
import { SettingsGroup, SettingsScroller, SwitchRow } from './ui';

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Miniature app window used by the theme cards. */
function ThemeThumb({ tone }: { tone: 'light' | 'dark' }) {
  const dark = tone === 'dark';
  return (
    <span
      className={cn('flex h-full w-full flex-col gap-1.5 p-2', dark ? 'bg-[#111117]' : 'bg-white')}
      aria-hidden
    >
      <span className={cn('h-2 w-10 rounded-full', dark ? 'bg-[#2a2935]' : 'bg-[#e7e5ef]')} />
      <span className="flex flex-1 flex-col justify-end gap-1">
        <span
          className={cn('h-3 w-3/5 self-start rounded-md', dark ? 'bg-[#1f1f29]' : 'bg-[#f1f0f6]')}
        />
        <span
          className={cn('h-3 w-1/2 self-end rounded-md', dark ? 'bg-[#3b3192]' : 'bg-[#e7e2ff]')}
        />
      </span>
    </span>
  );
}

function ThemePicker() {
  const theme = useUi((s) => s.theme);
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3 px-4 py-4 lg:px-5">
      {THEMES.map((t) => {
        const selected = theme === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => useUi.getState().setTheme(t.value)}
            className="group flex flex-col items-center gap-2 outline-none"
          >
            <span
              className={cn(
                'relative flex aspect-[4/3] w-full overflow-hidden rounded-xl border-2 transition-colors',
                selected ? 'border-brand' : 'border-line group-hover:border-line-strong',
                'group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-brand',
              )}
            >
              {t.value === 'system' ? (
                <>
                  <span className="w-1/2 overflow-hidden">
                    <ThemeThumb tone="light" />
                  </span>
                  <span className="w-1/2 overflow-hidden">
                    <ThemeThumb tone="dark" />
                  </span>
                </>
              ) : (
                <ThemeThumb tone={t.value} />
              )}
              {selected ? (
                <span className="absolute right-1.5 bottom-1.5 flex size-5 items-center justify-center rounded-full bg-brand text-on-brand">
                  <Check size={14} strokeWidth={ICON_STROKE_BOLD} aria-hidden />
                </span>
              ) : null}
            </span>
            <span className={cn('text-[14px]', selected ? 'font-semibold text-fg' : 'text-muted')}>
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WallpaperPicker() {
  const wallpaper = useUi((s) => s.prefs.wallpaper);
  const dark = useUi((s) => s.resolvedTheme === 'dark');
  return (
    <div
      role="radiogroup"
      aria-label="Chat wallpaper"
      className="grid grid-cols-4 gap-3 px-4 py-4 sm:grid-cols-7 lg:px-5"
    >
      {(Object.keys(WALLPAPERS) as WallpaperId[]).map((id) => {
        const wp = WALLPAPERS[id];
        const selected = wallpaper === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={wp.label}
            title={wp.label}
            onClick={() => useUi.getState().setPref('wallpaper', id)}
            className="group flex flex-col items-center gap-1.5 outline-none"
          >
            <span
              className={cn(
                'relative flex aspect-square w-full items-center justify-center rounded-xl border-2 transition-transform group-active:scale-95',
                selected ? 'border-brand' : 'border-line group-hover:border-line-strong',
                'group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-brand',
              )}
              style={{ backgroundColor: dark ? wp.dark : wp.light }}
            >
              {selected ? (
                <span className="flex size-6 items-center justify-center rounded-full bg-brand text-on-brand shadow">
                  <Check size={14} strokeWidth={ICON_STROKE_BOLD} aria-hidden />
                </span>
              ) : null}
            </span>
            <span className="text-[12px] text-muted">{wp.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function FontSizePicker() {
  const fontSize = useUi((s) => s.prefs.fontSize);
  return (
    <div
      role="radiogroup"
      aria-label="Chat text size"
      className="mx-4 my-4 flex rounded-full bg-surface-2 p-1 lg:mx-5"
    >
      {(Object.keys(FONT_SIZES) as FontSize[]).map((f) => {
        const selected = fontSize === f;
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => useUi.getState().setPref('fontSize', f)}
            className={cn(
              'h-9 flex-1 rounded-full font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-brand',
              selected ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
            style={{ fontSize: FONT_SIZES[f].px - 1 }}
          >
            {FONT_SIZES[f].label}
          </button>
        );
      })}
    </div>
  );
}

/** Live preview of wallpaper + text size. */
function ChatPreview() {
  return (
    <div
      className="chat-wallpaper mx-4 mt-4 flex flex-col gap-1.5 rounded-2xl border border-line p-4 lg:mx-5"
      aria-hidden
    >
      <div className="max-w-[78%] self-start rounded-2xl rounded-tl-md bg-bubble-in px-3 py-1.5 text-chat leading-snug text-fg shadow-bubble">
        Did you see the new wallpapers? 🎨
        <span className="ml-2 text-[11px] text-bubble-in-meta">10:41</span>
      </div>
      <div className="max-w-[78%] self-end rounded-2xl rounded-tr-md bg-bubble-out px-3 py-1.5 text-chat leading-snug text-fg shadow-bubble">
        Yes! This one looks great
        <span className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-bubble-out-meta">
          10:42 <DoubleTickIcon size={14} className="text-tick-read" />
        </span>
      </div>
    </div>
  );
}

/** Settings → Chats: theme, wallpaper, text size, enter to send (device preferences). */
export function ChatsSettingsPage() {
  const prefs = useUi((s) => s.prefs);
  return (
    <SettingsScroller>
      <SettingsGroup title="Theme">
        <ThemePicker />
      </SettingsGroup>
      <SettingsGroup title="Wallpaper" footer="Wallpaper and text size apply on this device only.">
        <ChatPreview />
        <WallpaperPicker />
        <SwitchRow
          icon={Sparkles}
          title="Wallpaper doodles"
          description="A subtle dot pattern over the wallpaper"
          checked={prefs.wallpaperPattern}
          onChange={(v) => useUi.getState().setPref('wallpaperPattern', v)}
        />
      </SettingsGroup>
      <SettingsGroup title="Chat text size">
        <FontSizePicker />
      </SettingsGroup>
      <SettingsGroup title="Chat settings">
        <SwitchRow
          icon={CornerDownLeft}
          title="Enter is send"
          description="Enter sends your message; Shift + Enter adds a new line"
          checked={prefs.enterToSend}
          onChange={(v) => useUi.getState().setPref('enterToSend', v)}
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}
