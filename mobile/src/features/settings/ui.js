/**
 * Building blocks for settings pages (web features/settings/ui.tsx): page scroller, grouped
 * cards (`.card-inset`), rows, switch rows, notes and the hero header.
 */
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
import { ICON_STROKE_ON_FILL, Icon } from '@/components/icons';
import { Press, SectionLabel, Switch, T } from '@/components/ui';
import { alpha, useTheme } from '@/theme';

export function SettingsScroller({ children, style, contentStyle }) {
  const { tw } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={[tw`min-h-0 flex-1 bg-surface`, style]}
      contentContainerStyle={[
        tw`w-full gap-5 self-center px-3 py-3`,
        { maxWidth: 672, paddingBottom: Math.max(24, insets.bottom + 12) },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function SettingsGroup({ title, footer, children, style }) {
  const { tw } = useTheme();
  return (
    <View style={style}>
      {title ? (
        typeof title === 'string' ? (
          <SectionLabel style={tw`px-2 pb-2`}>{title}</SectionLabel>
        ) : (
          <View style={tw`px-2 pb-2`}>{title}</View>
        )
      ) : null}
      <View style={tw`overflow-hidden rounded-xl bg-surface-2 p-1`}>{children}</View>
      {footer ? (
        typeof footer === 'string' ? (
          <T style={[tw`px-2 pt-2 text-[13px] text-muted`, { lineHeight: 21 }]}>{footer}</T>
        ) : (
          <View style={tw`px-2 pt-2`}>{footer}</View>
        )
      ) : null}
    </View>
  );
}

/** A tappable settings row: [icon] title / description … value › */
export function SettingsRow({
  icon,
  title,
  description,
  to,
  onPress,
  danger,
  end,
  chevron,
  disabled,
  active,
  descriptionLines,
  accessibilityLabel,
}) {
  const { tw, c } = useTheme();
  const router = useRouter();
  const press = to ? () => router.push(to) : onPress;
  const showChevron = chevron ?? !!press;
  const body = (
    <>
      {icon ? <Icon icon={icon} size={22} color={danger ? c.danger : c.muted} /> : null}
      <View style={tw`min-w-0 flex-1 gap-0.5`}>
        {typeof title === 'string' ? (
          <T style={[tw`text-[16px] leading-snug`, danger ? tw`text-danger` : null]}>{title}</T>
        ) : (
          title
        )}
        {description != null && description !== '' ? (
          typeof description === 'string' ? (
            <T numberOfLines={descriptionLines} style={tw`text-[13.5px] leading-snug text-muted`}>
              {description}
            </T>
          ) : (
            description
          )
        ) : null}
      </View>
      {end}
      {showChevron && !end ? <Icon icon={ChevronRight} size={18} color={c.subtle} /> : null}
    </>
  );
  const style = [
    tw`min-h-13 w-full flex-row items-center gap-4 rounded-lg px-3 py-2.5`,
    active ? tw`bg-selected` : null,
    disabled ? { opacity: 0.5 } : null,
  ];
  if (!press) return <View style={style}>{body}</View>;
  return (
    <Press
      onPress={press}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={style}
    >
      {body}
    </Press>
  );
}

/** A settings row with a switch (the whole row toggles). */
export function SwitchRow({ icon, title, description, checked, onChange, disabled }) {
  const { tw, c } = useTheme();
  return (
    <View style={tw`flex-row items-center gap-4 rounded-lg px-3`}>
      {icon ? <Icon icon={icon} size={22} color={c.muted} /> : null}
      <Switch
        label={title}
        description={description}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        style={tw`min-h-13 flex-1`}
      />
    </View>
  );
}

/** Explanatory paragraph inside a page. */
export function SettingsNote({ children, style }) {
  const { tw } = useTheme();
  return (
    <T style={[tw`px-2 py-1 text-[13.5px] text-muted`, { lineHeight: 22 }, style]}>{children}</T>
  );
}

/** Large centered header (icon + text) at the top of some pages. */
export function SettingsHero({ icon, title, children }) {
  const { tw, c } = useTheme();
  return (
    <View style={tw`items-center gap-3 px-6 py-8`}>
      <View style={tw`items-center justify-center`}>
        <View
          style={[
            tw`absolute size-32 rounded-full`,
            { backgroundColor: alpha(c.brand, 0.1), transform: [{ scale: 1.1 }] },
          ]}
        />
        <View style={tw`size-20 items-center justify-center rounded-full bg-brand-soft`}>
          <Icon icon={icon} size={36} strokeWidth={1.6} scale color={c['brand-ink']} />
        </View>
      </View>
      <T style={tw`text-center text-lg font-semibold`}>{title}</T>
      {children ? (
        <T style={[tw`text-center text-[14px] text-muted`, { maxWidth: 448, lineHeight: 22.75 }]}>
          {children}
        </T>
      ) : null}
    </View>
  );
}

/** iOS-style coloured tile behind a white section icon (the settings list). */
export function IconTile({ icon, color }) {
  const { tw } = useTheme();
  return (
    <View
      style={[
        tw`size-9 items-center justify-center rounded-[10px]`,
        { backgroundColor: color, boxShadow: 'inset 0px 0px 0px 0.5px rgba(0,0,0,0.12)' },
      ]}
    >
      <Icon icon={icon} size={20} color="#ffffff" strokeWidth={ICON_STROKE_ON_FILL} />
    </View>
  );
}
