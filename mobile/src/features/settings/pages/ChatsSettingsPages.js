/**
 * Settings → Chats and its sub-pages (web features/settings/ChatsSettingsPage.tsx): app
 * theme, device chat theme / bubble style, wallpaper, animations, text size and enter to
 * send — device preferences.
 */
import { View } from 'react-native';
import { Check, CornerDownLeft, Palette, Sparkles, Wallpaper, Zap } from 'lucide-react-native';
import { WALLPAPER_DIM_MAX } from '@enbox/shared';
import { ICON_STROKE_BOLD, Icon } from '@/components/icons';
import { Press, Segmented, T } from '@/components/ui';
import { ChatPreview } from '@/features/appearance/ChatPreview';
import { useDeviceAppearance } from '@/features/appearance/ChatBackground';
import {
  AnimationPicker,
  BUBBLE_STYLE_LABELS,
  BubbleStylePicker,
  MESSAGE_ANIMATION_LABELS,
  PresetGrid,
  SliderRow,
  WallpaperGrid,
} from '@/features/appearance/pickers';
import { CHAT_THEME_PRESET_DEFS, WALLPAPER_PRESET_DEFS } from '@/features/appearance/presets';
import { FONT_SIZES, useUi } from '@/stores/ui';
import { useTheme } from '@/theme';
import { SettingsGroup, SettingsRow, SettingsScroller, SwitchRow } from '../ui';

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Miniature app window used by the theme cards. */
function ThemeThumb({ tone }) {
  const { tw } = useTheme();
  const dark = tone === 'dark';
  return (
    <View style={[tw`flex-1 gap-1.5 p-2`, { backgroundColor: dark ? '#111117' : '#ffffff' }]}>
      <View
        style={[tw`h-2 w-10 rounded-full`, { backgroundColor: dark ? '#2a2935' : '#e7e5ef' }]}
      />
      <View style={tw`flex-1 justify-end gap-1`}>
        <View
          style={[
            tw`h-3 w-3/5 self-start rounded-md`,
            { backgroundColor: dark ? '#1f1f29' : '#f1f0f6' },
          ]}
        />
        <View
          style={[
            tw`h-3 w-1/2 self-end rounded-md`,
            { backgroundColor: dark ? '#3b3192' : '#e7e2ff' },
          ]}
        />
      </View>
    </View>
  );
}

function ThemePicker() {
  const { tw, c } = useTheme();
  const theme = useUi((s) => s.theme);
  return (
    <View accessibilityRole="radiogroup" style={tw`flex-row gap-3 px-4 py-4`}>
      {THEMES.map((t) => {
        const selected = theme === t.value;
        return (
          <Press
            key={t.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => useUi.getState().setTheme(t.value)}
            feedback={false}
            style={tw`min-w-0 flex-1 items-center gap-2`}
          >
            <View
              style={[
                tw`w-full flex-row overflow-hidden rounded-xl border-2`,
                { aspectRatio: 4 / 3, borderColor: selected ? c.brand : c.line },
              ]}
            >
              {t.value === 'system' ? (
                <>
                  <View style={tw`w-1/2 overflow-hidden`}>
                    <ThemeThumb tone="light" />
                  </View>
                  <View style={tw`w-1/2 overflow-hidden`}>
                    <ThemeThumb tone="dark" />
                  </View>
                </>
              ) : (
                <ThemeThumb tone={t.value} />
              )}
              {selected ? (
                <View
                  style={tw`absolute right-1.5 bottom-1.5 size-5 items-center justify-center rounded-full bg-brand`}
                >
                  <Icon
                    icon={Check}
                    size={14}
                    strokeWidth={ICON_STROKE_BOLD}
                    color={c['on-brand']}
                  />
                </View>
              ) : null}
            </View>
            <T style={[tw`text-[14px]`, selected ? tw`font-semibold` : tw`text-muted`]}>
              {t.label}
            </T>
          </Press>
        );
      })}
    </View>
  );
}

function FontSizePicker() {
  const { tw } = useTheme();
  const fontSize = useUi((s) => s.prefs.fontSize);
  return (
    <Segmented
      label="Chat text size"
      value={fontSize}
      onChange={(f) => useUi.getState().setPref('fontSize', f)}
      style={tw`mx-4 my-4`}
      options={Object.keys(FONT_SIZES).map((f) => ({
        value: f,
        label: FONT_SIZES[f].label,
        labelStyle: { fontSize: FONT_SIZES[f].px - 1 },
      }))}
    />
  );
}

function DevicePreview() {
  const { tw } = useTheme();
  const appearance = useDeviceAppearance();
  return <ChatPreview appearance={appearance} style={tw`mx-4 mt-4`} />;
}

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
          description="The keyboard's enter key sends your message instead of adding a new line"
          checked={prefs.enterToSend}
          onChange={(v) => useUi.getState().setPref('enterToSend', v)}
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}

export function ChatThemePage() {
  const { tw } = useTheme();
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
          style={tw`px-4 py-4`}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Bubble style"
        footer="Cozy shows messages as rows with the sender's name and photo, like a server chat."
      >
        <BubbleStylePicker
          value={prefs.bubbleStyle}
          onChange={(v) => useUi.getState().setPref('bubbleStyle', v)}
          style={tw`mx-4 my-4`}
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}

export function ChatWallpaperPage() {
  const { tw } = useTheme();
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
          style={tw`px-4 py-4`}
        />
        <SliderRow
          label="Dim"
          value={prefs.wallpaperDim}
          max={WALLPAPER_DIM_MAX}
          unit="%"
          onChange={(v) => useUi.getState().setPref('wallpaperDim', v)}
          style={tw`px-4 pb-4`}
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

export function ChatAnimationsPage() {
  const { tw } = useTheme();
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
          style={tw`mx-4 my-4`}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Reduce motion"
        footer="System follows your device's accessibility setting."
      >
        <Segmented
          label="Reduce motion"
          value={prefs.reduceMotion}
          onChange={(v) => useUi.getState().setPref('reduceMotion', v)}
          style={tw`mx-4 my-4`}
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
          label="Play animated media"
          value={prefs.autoplayAnimatedMedia}
          onChange={(v) => useUi.getState().setPref('autoplayAnimatedMedia', v)}
          style={tw`mx-4 my-4`}
          options={[
            { value: 'always', label: 'Always' },
            { value: 'hover', label: 'On tap' },
            { value: 'never', label: 'Never' },
          ]}
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}
