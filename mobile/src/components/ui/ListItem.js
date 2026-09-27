/**
 * Generic two-line list row (web components/ui/ListItem.tsx): chats, contacts, calls,
 * members, settings entries. Layout: [leading] [title … meta] / [subtitle … trailing] [end].
 * Rows are rounded `mx-2 my-0.5` cards that paint `bg-hover` while pressed and
 * `bg-selected` when `active`.
 */
import { View } from 'react-native';
import { useTheme } from '@/theme';
import { Press, T } from './primitives';

export function ListItem({
  leading,
  title,
  titleAdornment,
  subtitle,
  meta,
  trailing,
  end,
  onPress,
  onLongPress,
  active,
  highlight,
  dense,
  disabled,
  style,
  accessibilityLabel,
  titleLines = 1,
  subtitleLines = 1,
}) {
  const { tw } = useTheme();
  const interactive = !!(onPress || onLongPress) && !disabled;
  const body = (
    <>
      {leading ? <View style={dense ? null : tw`py-2`}>{leading}</View> : null}
      <View
        style={[
          tw`min-w-0 flex-1 flex-row items-center gap-3 self-stretch`,
          dense ? tw`py-1` : tw`py-2.5`,
        ]}
      >
        <View style={tw`min-w-0 flex-1 justify-center gap-0.5`}>
          <View style={tw`flex-row items-center gap-2`}>
            <View style={tw`min-w-0 flex-1 flex-row items-center gap-1.5`}>
              {typeof title === 'string' || typeof title === 'number' ? (
                <T
                  numberOfLines={titleLines}
                  style={[
                    tw`shrink text-[16px] leading-snug`,
                    highlight ? tw`font-semibold` : tw`font-medium`,
                  ]}
                >
                  {title}
                </T>
              ) : (
                <View style={tw`min-w-0 shrink`}>{title}</View>
              )}
              {titleAdornment}
            </View>
            {meta != null ? (
              typeof meta === 'string' ? (
                <T
                  style={[
                    tw`text-xs`,
                    { fontVariant: ['tabular-nums'] },
                    highlight ? tw`font-medium text-brand-ink` : tw`text-subtle`,
                  ]}
                >
                  {meta}
                </T>
              ) : (
                meta
              )
            ) : null}
          </View>
          {subtitle != null || trailing ? (
            <View style={tw`min-h-5 flex-row items-center gap-2`}>
              <View style={tw`min-w-0 flex-1`}>
                {typeof subtitle === 'string' ? (
                  <T
                    numberOfLines={subtitleLines}
                    style={[tw`text-[14px] leading-snug`, highlight ? tw`text-fg` : tw`text-muted`]}
                  >
                    {subtitle}
                  </T>
                ) : (
                  subtitle
                )}
              </View>
              {trailing ? <View style={tw`flex-row items-center gap-1.5`}>{trailing}</View> : null}
            </View>
          ) : null}
        </View>
        {end ? <View style={tw`flex-row items-center`}>{end}</View> : null}
      </View>
    </>
  );
  const rowStyle = [
    tw`mx-2 my-px flex-row items-center gap-3 rounded-xl`,
    dense ? tw`px-3 py-1.5` : tw`px-2.5`,
    active ? tw`bg-selected` : null,
    disabled ? { opacity: 0.5 } : null,
    style,
  ];
  if (!interactive) return <View style={rowStyle}>{body}</View>;
  return (
    <Press
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={rowStyle}
      pressedStyle={active ? tw`bg-selected` : tw`bg-hover`}
    >
      {body}
    </Press>
  );
}

/** Discord-style uppercase section label (`.section-label`). */
export function SectionLabel({ children, style }) {
  const { tw } = useTheme();
  return (
    <T style={[tw`text-[11px] font-semibold uppercase text-muted`, { letterSpacing: 0.44 }, style]}>
      {children}
    </T>
  );
}

/** Small section title inside lists. */
export function ListSection({ title, action, children, style }) {
  const { tw } = useTheme();
  return (
    <View style={style}>
      {title || action ? (
        <View style={tw`flex-row items-center justify-between px-4 pt-4 pb-1.5`}>
          {title ? (
            typeof title === 'string' ? (
              <SectionLabel>{title}</SectionLabel>
            ) : (
              title
            )
          ) : (
            <View />
          )}
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}
