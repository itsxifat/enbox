import { useAppVisible } from '@/hooks/useAppVisible';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { useUi, type AutoplayAnimatedMedia } from '@/stores/ui';

export interface CosmeticMotion {
  /** Cosmetics may animate now: no reduced motion, the app is in view, animated media allowed. */
  animate: boolean;
  reduced: boolean;
  visible: boolean;
  autoplay: AutoplayAnimatedMedia;
}

/**
 * Whether profile cosmetics (decorations, effects, nameplates) may move. Only the few
 * always-on surfaces subscribe (profile cards, the editor, Collectibles): list rows animate
 * on hover through CSS (components/cosmetics/cosmetics.css), which reads the same prefs from
 * `html[data-reduce-motion]` / `html[data-autoplay-media]` without a subscription per row.
 */
export function useCosmeticMotion(): CosmeticMotion {
  const reduced = useReducedMotion();
  const visible = useAppVisible();
  const autoplay = useUi((s) => s.prefs.autoplayAnimatedMedia);
  return { animate: !reduced && visible && autoplay !== 'never', reduced, visible, autoplay };
}
