/**
 * Consistent header for tab panes and full-screen pages (web components/layout/PaneHeader):
 * back arrow (or ×), leading avatar, title/subtitle (large brand title on the Chats tab),
 * actions on the right and optional rows underneath (search box, filter chips). Handles the
 * top safe-area inset.
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, X } from 'lucide-react-native';
import { IconButton, Press, T } from '@/components/ui';
import { useTheme } from '@/theme';
import { useBanner } from './ConnectionBanner';

export function PaneHeader({
  title,
  subtitle,
  back,
  backIcon = 'arrow',
  actions,
  leading,
  large,
  brandTitle,
  children,
  onTitlePress,
  style,
  safeTop = true,
}) {
  const { tw } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bannerShown = useBanner((s) => s.shown);
  const goBack = () => {
    if (typeof back === 'function') return back();
    if (router.canGoBack()) router.back();
    else router.replace(typeof back === 'string' ? back : '/chats');
  };
  const titleBlock = (
    <View style={tw`min-w-0 flex-1`}>
      {typeof title === 'string' || typeof title === 'number' ? (
        <T
          numberOfLines={1}
          style={[
            tw`font-semibold`,
            { letterSpacing: large ? -0.55 : -0.425 },
            large ? tw`text-[22px] leading-tight` : tw`text-[17px] leading-snug`,
            brandTitle ? tw`text-brand-ink` : null,
          ]}
        >
          {title}
        </T>
      ) : (
        title
      )}
      {subtitle ? (
        typeof subtitle === 'string' ? (
          <T numberOfLines={1} style={tw`text-[13px] leading-tight text-muted`}>
            {subtitle}
          </T>
        ) : (
          subtitle
        )
      ) : null}
    </View>
  );
  return (
    <View style={[tw`bg-surface`, { paddingTop: safeTop && !bannerShown ? insets.top : 0 }, style]}>
      <View style={[tw`h-16 flex-row items-center gap-1`, large ? tw`pr-2 pl-4` : tw`px-2`]}>
        {back ? (
          <IconButton
            icon={backIcon === 'close' ? X : ArrowLeft}
            label={backIcon === 'close' ? 'Close' : 'Back'}
            onPress={goBack}
          />
        ) : null}
        {leading}
        {onTitlePress ? (
          <Press
            onPress={onTitlePress}
            style={tw`min-w-0 flex-1 flex-row items-center rounded-lg px-1 py-1`}
          >
            {titleBlock}
          </Press>
        ) : (
          <View style={[tw`min-w-0 flex-1 flex-row items-center`, !large && tw`px-1`]}>
            {titleBlock}
          </View>
        )}
        {actions ? <View style={tw`flex-row items-center gap-0.5`}>{actions}</View> : null}
      </View>
      {children ? <View style={tw`px-3 pb-2`}>{children}</View> : null}
    </View>
  );
}
