import type { NameStyle, RoleColorStyle } from '@enbox/shared';
import { cn } from '@/lib/cn';

/** The colour part of a Space role, as names wear it. */
export interface RoleNameStyle {
  color: string | null;
  colorSecondary?: string | null;
  colorStyle?: RoleColorStyle;
}

export interface StyledNameProps {
  name: string;
  /** The user's display name style (font, effect, colours). */
  style?: NameStyle | null;
  /** Inside a Space: the top coloured role wins over the user's colours (the font stays). */
  role?: RoleNameStyle | null;
  /** 'full' (profiles, member list, DM rows): font + effect; 'font' (message rows): font + role colour. */
  mode?: 'full' | 'font';
  className?: string;
}

/** Contract stub (W3): the cosmetics stream adds fonts and effects. */
export function StyledName({ name, role, className }: StyledNameProps) {
  return (
    <span className={cn('min-w-0', className)} style={role?.color ? { color: role.color } : undefined}>
      {name}
    </span>
  );
}
