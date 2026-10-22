/** Contract stub (W3): the cosmetics stream draws the decorations. */
export interface AvatarDecorationProps {
  /** AVATAR_DECORATIONS id; null or an unknown id renders nothing. */
  id: string | null | undefined;
  /** The avatar's size in px; the decoration draws at ~1.2x, centred on the avatar. */
  size: number;
  /**
   * 'hover' (lists: plays while the closest `[data-animate-avatars]` host is hovered),
   * 'always' (profiles, editor preview), 'never'. Reduced motion and a hidden app freeze it.
   */
  animate?: 'hover' | 'always' | 'never';
}

export function AvatarDecoration(_props: AvatarDecorationProps) {
  return null;
}
