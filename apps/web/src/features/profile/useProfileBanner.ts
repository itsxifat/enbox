import type { UserPublic } from '@enbox/shared';
import { useAppVisible } from '@/hooks/useAppVisible';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { mediaUrl } from '@/lib/api';
import { useUi } from '@/stores/ui';

/**
 * The banner to show on a profile surface: the animated original while `wanted` (the
 * profile card, the one surface that always wants it; the contact panel and `/u/:username`
 * only while their hero is hovered or focused — same rules as `Avatar animate="hover"`, so
 * the `autoplayAnimatedMedia: 'always'` pref plays it regardless) and allowed (never under
 * reduced motion, the pref 'never' or a hidden / unfocused app), else the static poster;
 * undefined without a banner.
 */
export function useProfileBannerSrc(
  user: Pick<UserPublic, 'bannerUrl' | 'bannerAnimatedUrl'> | null | undefined,
  wanted = true,
): string | undefined {
  const reduceMotion = useReducedMotion();
  const autoplay = useUi((s) => s.prefs.autoplayAnimatedMedia);
  const appVisible = useAppVisible();
  if (!user) return undefined;
  const play =
    !!user.bannerAnimatedUrl &&
    (wanted || autoplay === 'always') &&
    !reduceMotion &&
    autoplay !== 'never' &&
    appVisible;
  return mediaUrl(play ? user.bannerAnimatedUrl : user.bannerUrl);
}
