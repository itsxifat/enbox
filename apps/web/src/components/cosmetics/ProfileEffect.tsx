/** Contract stub (W3): the cosmetics stream draws the effects. */
export interface ProfileEffectProps {
  /** PROFILE_EFFECTS id; null or an unknown id renders nothing. */
  id: string | null | undefined;
  /** Overlay over the whole profile surface (`absolute inset-0 pointer-events-none`). */
  className?: string;
  /**
   * 'once' (default: plays when shown, then rests on a still frame; replays when `replayKey`
   * changes, e.g. on hover), 'loop' (editor preview, Collectibles), 'still'.
   */
  play?: 'once' | 'loop' | 'still';
  replayKey?: number | string;
}

export function ProfileEffect(_props: ProfileEffectProps) {
  return null;
}
