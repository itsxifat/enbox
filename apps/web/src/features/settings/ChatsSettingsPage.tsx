import { Check, CornerDownLeft, Palette, Sparkles, Wallpaper, Zap } from 'lucide-react';
import { ICON_STROKE_BOLD } from '@/components/icons';
import { ChatPreview } from '@/features/appearance/ChatPreview';
import {
  AnimationPicker,
  BUBBLE_STYLE_LABELS,
  BubbleStylePicker,
  MESSAGE_ANIMATION_LABELS,
  PresetGrid,
  Segmented,
  SliderRow,
  WallpaperGrid,
} from '@/features/appearance/pickers';
import { CHAT_THEME_PRESET_DEFS, WALLPAPER_PRESET_DEFS } from '@/features/appearance/presets';
import { useDeviceAppearance } from '@/features/appearance/useChatAppearance';
import { cn } from '@/lib/cn';
import { FONT_SIZES, useUi, type FontSize, type ThemePref } from '@/stores/ui';
import { WALLPAPER_DIM_MAX } from '@enbox/shared';
import { SettingsGroup, SettingsRow, SettingsScroller, SwitchRow } from './ui';

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

/** Live preview of the device appearance (theme preset, wallpaper, bubbles, text size). */
function DevicePreview() {
  const appearance = useDeviceAppearance();
  return <ChatPreview appearance={appearance} className="mx-4 mt-4 min-h-28 lg:mx-5" />;
}

/** Settings → Chats: theme, wallpaper, animations, text size, enter to send (device preferences). */
export function ChatsSettingsPage() {
  const prefs = useUi((s) => s.prefs);
  return (
    <SettingsScroller>
      <SettingsGroup title="Theme">
        <ThemePicker />
        <SettingsRow
          icon={Palette}
          title="Chat theme"
          description={`${CHAT_THEME_PRESET_DEFS[prefs.chatTheme].label} · ${BUBBLE_STYLE_LABELS[prefs.bubbleStyle]} bubbles`}
          to="/settings/chats/theme"
        />
      </SettingsGroup>
      <SettingsGroup
        title="Wallpaper"
        footer="Theme, wallpaper and text size apply on this device. A chat's own theme (from its menu) comes first."
      >
        <DevicePreview />
        <SettingsRow
          icon={Wallpaper}
          title="Wallpaper"
          description={WALLPAPER_PRESET_DEFS[prefs.wallpaperPreset].label}
          to="/settings/chats/wallpaper"
        />
      </SettingsGroup>
      <SettingsGroup title="Animations">
        <SettingsRow
          icon={Zap}
          title="Message animation"
          description={MESSAGE_ANIMATION_LABELS[prefs.messageAnimation]}
          to="/settings/chats/animations"
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

/** Settings → Chats → Chat theme: the device preset and bubble style. */
export function ChatThemePage() {
  const prefs = useUi((s) => s.prefs);
  const resolvedTheme = useUi((s) => s.resolvedTheme);
  return (
    <SettingsScroller>
      <SettingsGroup title="Theme">
        <DevicePreview />
        <PresetGrid
          value={prefs.chatTheme}
          onChange={(v) => useUi.getState().setPref('chatTheme', v)}
          resolvedTheme={resolvedTheme}
          className="px-4 py-4 lg:px-5"
        />
      </SettingsGroup>
      <SettingsGroup
        title="Bubble style"
        footer="Cozy shows messages as rows with the sender's name and photo, like a server chat."
      >
        <BubbleStylePicker
          value={prefs.bubbleStyle}
          onChange={(v) => useUi.getState().setPref('bubbleStyle', v)}
          className="mx-4 my-4 lg:mx-5"
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}

/** Settings → Chats → Wallpaper: the device wallpaper preset, dim and doodles. */
export function ChatWallpaperPage() {
  const prefs = useUi((s) => s.prefs);
  const resolvedTheme = useUi((s) => s.resolvedTheme);
  return (
    <SettingsScroller>
      <SettingsGroup
        title="Wallpaper"
        footer="Upload your own photo or video from a chat's theme menu."
      >
        <DevicePreview />
        <WallpaperGrid
          value={prefs.wallpaperPreset}
          onChange={(v) => {
            if (v !== 'media') useUi.getState().setPref('wallpaperPreset', v);
          }}
          resolvedTheme={resolvedTheme}
          className="px-4 py-4 lg:px-5"
        />
        <SliderRow
          label="Dim"
          value={prefs.wallpaperDim}
          max={WALLPAPER_DIM_MAX}
          unit="%"
          onChange={(v) => useUi.getState().setPref('wallpaperDim', v)}
          className="px-4 pb-4 lg:px-5"
        />
        <SwitchRow
          icon={Sparkles}
          title="Wallpaper doodles"
          description="A subtle dot pattern over flat wallpapers"
          checked={prefs.wallpaperPattern}
          onChange={(v) => useUi.getState().setPref('wallpaperPattern', v)}
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}

/** Settings → Chats → Animations: message enter animation, reduced motion, animated media. */
export function ChatAnimationsPage() {
  const prefs = useUi((s) => s.prefs);
  return (
    <SettingsScroller>
      <SettingsGroup
        title="New messages"
        footer="How messages appear as they arrive. Off under reduced motion."
      >
        <DevicePreview />
        <AnimationPicker
          value={prefs.messageAnimation}
          onChange={(v) => useUi.getState().setPref('messageAnimation', v)}
          className="mx-4 my-4 lg:mx-5"
        />
      </SettingsGroup>
      <SettingsGroup
        title="Reduce motion"
        footer="System follows your device's accessibility setting."
      >
        <Segmented
          aria-label="Reduce motion"
          value={prefs.reduceMotion}
          onChange={(v) => useUi.getState().setPref('reduceMotion', v)}
          className="mx-4 my-4 lg:mx-5"
          options={[
            { value: 'system', label: 'System' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Animated photos and GIFs"
        footer="Animated profile photos, GIFs and wallpapers."
      >
        <Segmented
          aria-label="Play animated media"
          value={prefs.autoplayAnimatedMedia}
          onChange={(v) => useUi.getState().setPref('autoplayAnimatedMedia', v)}
          className="mx-4 my-4 lg:mx-5"
          options={[
            { value: 'always', label: 'Always' },
            { value: 'hover', label: 'On hover' },
            { value: 'never', label: 'Never' },
          ]}
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}
