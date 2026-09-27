/**
 * Building blocks for info panels (web features/groups/shared/InfoLayout.tsx): stacked
 * `.card-inset` cards with icon rows, round quick actions and role pills.
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Icon } from '@/components/icons';
import { Press, SectionLabel, T } from '@/components/ui';
import { useTheme } from '@/theme';

export function InfoPage({ children, style }) {
  const { tw } = useTheme();
  return <View style={[tw`flex-1 gap-3 bg-surface px-3 pb-6`, style]}>{children}</View>;
}

export function InfoSection({ title, action, children, style, flush, accessibilityLabel }) {
  const { tw } = useTheme();
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[tw`overflow-hidden rounded-xl bg-surface-2`, flush ? null : tw`py-1`, style]}
    >
      {title || action ? (
        <View style={tw`min-h-10 flex-row items-center justify-between gap-3 px-5 pt-2 pb-1`}>
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

export function InfoRow({
  icon,
  label,
  description,
  value,
  trailing,
  onPress,
  onLongPress,
  to,
  danger,
  chevron,
  disabled,
  style,
  accessibilityLabel,
  descriptionLines,
}) {
  const { tw, c } = useTheme();
  const router = useRouter();
  const press = to ? () => router.push(to) : onPress;
  const clickable = !!press && !disabled;
  const showChevron = chevron ?? (clickable && !trailing && !danger);
  const body = (
    <>
      {icon ? <Icon icon={icon} size={22} color={danger ? c.danger : c.muted} /> : null}
      <View style={tw`min-w-0 flex-1`}>
        {typeof label === 'string' ? (
          <T style={[tw`text-[15.5px] leading-snug`, danger ? tw`text-danger` : null]}>{label}</T>
        ) : (
          label
        )}
        {description ? (
          typeof description === 'string' ? (
            <T
              numberOfLines={descriptionLines}
              style={tw`mt-0.5 text-[13px] leading-snug text-muted`}
            >
              {description}
            </T>
          ) : (
            <View style={tw`mt-0.5`}>{description}</View>
          )
        ) : null}
      </View>
      {value ? (
        typeof value === 'string' ? (
          <T style={tw`text-[14px] text-muted`}>{value}</T>
        ) : (
          value
        )
      ) : null}
      {trailing}
      {showChevron ? <Icon icon={ChevronRight} size={18} color={c.subtle} /> : null}
    </>
  );
  const rowStyle = [
    tw`w-full flex-row items-center gap-5 px-5 py-3`,
    disabled ? { opacity: 0.5 } : null,
    style,
  ];
  if (!press && !onLongPress) return <View style={rowStyle}>{body}</View>;
  return (
    <Press
      onPress={press}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={rowStyle}
    >
      {body}
    </Press>
  );
}

/** Round quick-action button under the info header (Audio / Video / Add / Share…). */
export function QuickAction({ icon, label, onPress, disabled }) {
  const { tw, c } = useTheme();
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      style={[
        tw`w-[84px] items-center gap-1.5 rounded-2xl bg-surface-2 px-2 py-2.5`,
        disabled ? { opacity: 0.4 } : null,
      ]}
    >
      <Icon icon={icon} size={22} color={c['brand-ink']} />
      <T style={tw`text-[13px] font-medium`}>{label}</T>
    </Press>
  );
}

/** Small pill (roles, "Admin", "You"). */
export function RolePill({ children, tone = 'brand' }) {
  const { tw } = useTheme();
  return (
    <View
      style={[
        tw`h-6 items-center justify-center rounded-full px-2.5`,
        tone === 'brand' ? tw`bg-brand-soft` : tw`bg-surface-2`,
      ]}
    >
      <T
        style={[
          tw`text-[12px] font-medium`,
          tone === 'brand' ? tw`text-brand-ink` : tw`text-muted`,
        ]}
      >
        {children}
      </T>
    </View>
  );
}
