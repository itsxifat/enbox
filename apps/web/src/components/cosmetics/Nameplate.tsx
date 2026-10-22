/** Contract stub (W3): the cosmetics stream draws the nameplates. */
export interface NameplateProps {
  /** NAMEPLATES id; null or an unknown id renders nothing. */
  id: string | null | undefined;
  /** Sits absolutely behind a row's content (`absolute inset-0`, rounded like the row). */
  className?: string;
  /** 'hover' (default: animates while the closest `[data-animate-avatars]` host is hovered), 'always', 'never'. */
  animate?: 'hover' | 'always' | 'never';
}

export function Nameplate(_props: NameplateProps) {
  return null;
}
