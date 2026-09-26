import type { UserPublic } from '@enbox/shared';
import { useAppVisible } from '@/hooks/useAppVisible';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { mediaUrl } from '@/lib/api';
import { useUi } from '@/stores/ui';

/**
 * The banner to show on a profile surface: the animated original while the card is the
 * focus (same rules as `Avatar animate="always"`: never under reduced motion, the
 * `autoplayAnimatedMedia: 'never'` pref or a hidden / unfocused app), else the static poster;
 * undefined without a banner.
 */
export function useProfileBannerSrc(
  user: Pick<UserPublic, 'bannerUrl' | 'bannerAnimatedUrl'> | null | undefined,
): string | undefined {
  const reduceMotion = useReducedMotion();
  const autoplay = useUi((s) => s.prefs.autoplayAnimatedMedia);
  const appVisible = useAppVisible();
  if (!user) return undefined;
  const play = !!user.bannerAnimatedUrl && !reduceMotion && autoplay !== 'never' && appVisible;
  return mediaUrl(play ? user.bannerAnimatedUrl : user.bannerUrl);
}
