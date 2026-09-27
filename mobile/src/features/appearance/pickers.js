/**
 * Appearance pickers shared by the ChatThemeSheet and Settings → Chats (web
 * features/appearance/pickers.tsx): preset swatches, bubble style / animation segments, the
 * accent colour (curated swatches + hex input), wallpaper tiles and the dim/blur sliders.
 */
import { TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Check, ImagePlus, Sparkles } from 'lucide-react-native';
import {
  BUBBLE_STYLES,
  CHAT_THEME_PRESETS,
  MESSAGE_ANIMATIONS,
  WALLPAPER_PRESETS,
} from '@enbox/shared';
import { ICON_STROKE_BOLD, Icon } from '@/components/icons';
import { Press, Segmented, Slider, Spinner, T } from '@/components/ui';
import { mediaUrl } from '@/lib/api';
import { alpha, useTheme } from '@/theme';
import { CHAT_THEME_PRESET_DEFS, WALLPAPER_PRESET_DEFS, isAccentHex } from './presets';

export { Segmented };

export const BUBBLE_STYLE_LABELS = {
  classic: 'Classic',
  rounded: 'Rounded',
  minimal: 'Minimal',
  cozy: 'Cozy',
};

export const MESSAGE_ANIMATION_LABELS = {
  none: 'None',
  fade: 'Fade',
  slide: 'Slide',
  pop: 'Pop',
};

export function BubbleStylePicker({ value, onChange, style }) {
  return (
    <Segmented
      label="Bubble style"
      value={value}
      onChange={onChange}
      style={style}
      options={BUBBLE_STYLES.map((s) => ({ value: s, label: BUBBLE_STYLE_LABELS[s] }))}
    />
  );
}

export function AnimationPicker({ value, onChange, style }) {
  return (
    <Segmented
      label="Message animation"
      value={value}
      onChange={onChange}
      style={style}
      options={MESSAGE_ANIMATIONS.map((a) => ({ value: a, label: MESSAGE_ANIMATION_LABELS[a] }))}
    />
  );
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

/** A grid of equal columns (the web's `grid grid-cols-4 gap-3`). */
function Grid({ cols = 4, gap = 12, children, style, label }) {
  const { tw } = useTheme();
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : [children];
  const rows = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[{ gap }, style]}>
      {rows.map((row, r) => (
        <View key={r} style={[tw`flex-row`, { gap }]}>
          {row.map((item, i) => (
            <View key={i} style={tw`min-w-0 flex-1`}>
              {item}
            </View>
          ))}
          {row.length < cols
            ? Array.from({ length: cols - row.length }, (_, i) => (
                <View key={`pad${i}`} style={tw`flex-1`} />
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

function Tile({ selected, label, onPress, children, style }) {
  const { tw, c, shadow } = useTheme();
  return (
    <Press
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      feedback={false}
      style={tw`min-w-0 items-center gap-1.5`}
    >
      {({ pressed }) => (
        <>
          <View
            style={[
              tw`w-full items-center justify-center overflow-hidden rounded-xl`,
              { aspectRatio: 1, transform: [{ scale: pressed ? 0.95 : 1 }] },
              style,
            ]}
          >
            {children}
            <View
              pointerEvents="none"
              style={[
                tw`absolute inset-0 rounded-xl border-2`,
                { borderColor: selected ? c.brand : 'transparent' },
              ]}
            />
            {selected ? (
              <View
                style={[
                  tw`absolute right-1 bottom-1 size-5 items-center justify-center rounded-full bg-brand`,
                  shadow.sm,
                ]}
              >
                <Icon icon={Check} size={12} strokeWidth={ICON_STROKE_BOLD} color={c['on-brand']} />
              </View>
            ) : null}
          </View>
          <T
            numberOfLines={1}
            style={[tw`text-[12px]`, selected ? tw`font-semibold text-fg` : tw`text-muted`]}
          >
            {label}
          </T>
        </>
      )}
    </Press>
  );
}

/** Theme preset swatches: two mini bubbles on the preset's wallpaper colour. */
export function PresetGrid({ value, onChange, resolvedTheme, style }) {
  const { tw } = useTheme();
  const dark = resolvedTheme === 'dark';
  return (
    <Grid cols={4} style={style} label="Chat theme">
      {CHAT_THEME_PRESETS.map((id) => {
        const def = CHAT_THEME_PRESET_DEFS[id];
        const v = def[resolvedTheme];
        const wallpaper = v?.['--wallpaper'] ?? (dark ? '#0d0d13' : '#efedf5');
        const out = v?.['--bubble-out'] ?? (dark ? '#3b3192' : '#e7e2ff');
        const inn = v?.['--bubble-in'] ?? (dark ? '#1f1f29' : '#ffffff');
        return (
          <Tile key={id} selected={value === id} label={def.label} onPress={() => onChange(id)}>
            <View style={[tw`size-full justify-center gap-1 p-2`, { backgroundColor: wallpaper }]}>
              <View style={[tw`h-2.5 w-3/5 self-start rounded-md`, { backgroundColor: inn }]} />
              <View style={[tw`h-2.5 w-3/5 self-end rounded-md`, { backgroundColor: out }]} />
            </View>
          </Tile>
        );
      })}
    </Grid>
  );
}

// ---------------------------------------------------------------------------
// Accent
// ---------------------------------------------------------------------------

/** Curated accents that pass `contrastOk` in the mode they are offered for. */
export const ACCENT_SWATCHES = {
  light: ['#e7e2ff', '#cfe8ff', '#d4f5e2', '#ffe4c7', '#ffd6e2', '#fff3b8', '#e2e8f0', '#e5f7ff'],
  dark: ['#3b3192', '#0f4a63', '#17492c', '#6a2f14', '#5f2440', '#5a4a10', '#33333b', '#1c3a5c'],
};

export function AccentPicker({ value, onChange, resolvedTheme, error, style }) {
  const { tw, c } = useTheme();
  return (
    <View style={[tw`gap-3`, style]}>
      <View accessibilityRole="radiogroup" style={tw`flex-row flex-wrap gap-2`}>
        <Press
          accessibilityRole="radio"
          accessibilityState={{ checked: value === null }}
          accessibilityLabel="Preset colour"
          onPress={() => onChange(null)}
          feedback={false}
          style={[
            tw`h-9 flex-row items-center rounded-full border-2 px-3`,
            value === null
              ? { backgroundColor: c['brand-soft'], borderColor: c.brand }
              : { backgroundColor: c['surface-2'], borderColor: 'transparent' },
          ]}
        >
          <T
            style={[
              tw`text-[13px] font-medium`,
              { color: value === null ? c['brand-ink'] : c.muted },
            ]}
          >
            Auto
          </T>
        </Press>
        {ACCENT_SWATCHES[resolvedTheme].map((hex) => {
          const selected = value === hex;
          return (
            <Press
              key={hex}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={hex}
              onPress={() => onChange(hex)}
              feedback={false}
              style={[
                tw`size-9 items-center justify-center rounded-full`,
                {
                  backgroundColor: hex,
                  boxShadow: selected
                    ? `0px 0px 0px 2px ${c.surface}, 0px 0px 0px 4px ${c.brand}`
                    : undefined,
                },
              ]}
            >
              {selected ? (
                <Icon icon={Check} size={14} strokeWidth={ICON_STROKE_BOLD} color={c.fg} />
              ) : null}
            </Press>
          );
        })}
      </View>
      <View style={tw`flex-row items-center gap-3`}>
        <View
          style={[
            tw`size-9 rounded-full border border-line`,
            { backgroundColor: value && isAccentHex(value) ? value : 'transparent' },
          ]}
        />
        <View style={tw`min-w-0 flex-1 gap-1`}>
          <TextInput
            accessibilityLabel="Custom accent (hex)"
            value={value ?? ''}
            onChangeText={(t) => onChange(t === '' ? null : t)}
            placeholder="#rrggbb"
            placeholderTextColor={c.subtle}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            selectionColor={alpha(c.brand, 0.5)}
            cursorColor={c.brand}
            style={[
              tw`h-10 w-full rounded-xl border bg-surface-2 px-3 text-[14px] text-fg`,
              { fontFamily: 'monospace', borderColor: error ? c.danger : 'transparent' },
            ]}
          />
          {error ? (
            <T accessibilityRole="alert" style={tw`text-[12.5px] text-danger`}>
              {error}
            </T>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Wallpaper
// ---------------------------------------------------------------------------

export function WallpaperGrid({
  value,
  onChange,
  resolvedTheme,
  media,
  onUpload,
  uploading,
  style,
}) {
  const { tw, c } = useTheme();
  return (
    <Grid cols={4} style={style} label="Wallpaper">
      {WALLPAPER_PRESETS.map((id) => {
        const def = WALLPAPER_PRESET_DEFS[id];
        return (
          <Tile key={id} selected={value === id} label={def.label} onPress={() => onChange(id)}>
            <View style={[tw`size-full`, { backgroundColor: def[resolvedTheme] }]} />
            {def.animated ? (
              <View
                style={[
                  tw`absolute top-1 left-1 size-5 items-center justify-center rounded-full`,
                  { backgroundColor: alpha(c.surface, 0.85) },
                ]}
              >
                <Icon icon={Sparkles} size={12} color={c['brand-ink']} />
              </View>
            ) : null}
          </Tile>
        );
      })}
      {media ? (
        <Tile
          selected={value === 'media'}
          label="My photo"
          onPress={() => onChange('media')}
          style={tw`bg-surface-2`}
        >
          <Image
            source={{ uri: mediaUrl(media.thumbnailUrl ?? media.url) }}
            style={tw`size-full`}
            contentFit="cover"
          />
        </Tile>
      ) : null}
      {onUpload ? (
        <View style={tw`min-w-0 items-center gap-1.5`}>
          <Press
            onPress={onUpload}
            disabled={uploading}
            accessibilityLabel="Upload a photo, GIF or video"
            style={[
              tw`w-full items-center justify-center rounded-xl border-2 border-dashed border-line-strong`,
              { aspectRatio: 1, opacity: uploading ? 0.6 : 1 },
            ]}
          >
            {uploading ? (
              <Spinner size={20} />
            ) : (
              <Icon icon={ImagePlus} size={22} color={c.muted} />
            )}
          </Press>
          <T numberOfLines={1} style={tw`text-[12px] text-muted`}>
            Upload
          </T>
        </View>
      ) : null}
    </Grid>
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
  style,
}) {
  const { tw } = useTheme();
  return (
    <View style={[tw`flex-row items-center gap-3`, style]}>
      <T style={tw`w-14 text-[14px]`}>{label}</T>
      <Slider
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        disabled={disabled}
        style={tw`min-w-0 flex-1`}
      />
      <T style={[tw`w-12 text-right text-[13px] text-muted`, { fontVariant: ['tabular-nums'] }]}>
        {value}
        {unit}
      </T>
    </View>
  );
}
