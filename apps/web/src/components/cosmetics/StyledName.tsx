import type { CSSProperties } from 'react';
import { isNameEffectId, isNameFontId, type NameStyle, type RoleColorStyle } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { NAME_FONT_DEFS, loadNameFont } from '@/lib/nameFonts';
import { useUi, type RoleColorDisplay } from '@/stores/ui';
import './cosmetics.css';

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
  /**
   * When a holographic role shimmers: 'hover' (default: while the closest
   * `[data-animate-avatars]` row is hovered), 'always' (profile cards), 'never'.
   */
  animate?: 'hover' | 'always' | 'never';
  /**
   * Where a role's colour shows: on the name ('names'), as a dot after the plain name ('dot')
   * or nowhere ('hidden'). Default: the device pref `roleColors` (Settings ▸ Accessibility);
   * role editors pass 'names'.
   */
  roleDisplay?: RoleColorDisplay;
  className?: string;
}

/** A name in the user's chosen font and effect, or in their top Space role's colours. */
export function StyledName(props: StyledNameProps) {
  // Plain names (nearly every row) render without subscribing to the prefs.
  if (!hasUserStyle(props.style) && !hasRoleColor(props.role))
    return <NameSpan {...props} style={null} />;
  return <PrefGatedName {...props} />;
}

function hasUserStyle(style: NameStyle | null | undefined): style is NameStyle {
  if (!style) return false;
  return (
    (isNameFontId(style.font) && style.font !== 'default') ||
    (isNameEffectId(style.effect) && !!style.colors?.length)
  );
}

function hasRoleColor(role: RoleNameStyle | null | undefined): role is RoleNameStyle {
  return !!role && (!!role.color || role.colorStyle === 'holographic');
}

/**
 * Device prefs "Show name styles" (off: plain names, role colours still apply) and "Role
 * colours" (in names, as a dot next to them, or not at all).
 */
function PrefGatedName(props: StyledNameProps) {
  const show = useUi((s) => s.prefs.showNameStyles);
  const pref = useUi((s) => s.prefs.roleColors);
  const display = props.roleDisplay ?? pref;
  const style = show ? props.style : null;
  if (!hasRoleColor(props.role) || display === 'names')
    return <NameSpan {...props} style={style} />;
  const name = <NameSpan {...props} style={style} role={null} />;
  if (display === 'hidden') return name;
  return (
    <>
      {name}
      <RoleDot role={props.role} />
    </>
  );
}

/** "Show role colours next to names": a dot in the role's colours after the name. */
function RoleDot({ role }: { role: RoleNameStyle }) {
  const { kind, c1, c2 } = resolveRoleStyle(role);
  const background =
    kind === 'holographic'
      ? 'conic-gradient(#a9c9ff, #ffbbec, #fff2a8, #a9ffe0, #a9c9ff)'
      : kind === 'gradient'
        ? `linear-gradient(135deg, ${c1}, ${c2})`
        : c1;
  return (
    <span
      className="cos-role-dot inline-block size-2 shrink-0 rounded-full"
      data-role={kind}
      style={{ background }}
      aria-hidden
    />
  );
}

function NameSpan({
  name,
  style,
  role,
  mode = 'full',
  animate = 'hover',
  className,
}: StyledNameProps) {
  const font = style && isNameFontId(style.font) && style.font !== 'default' ? style.font : null;
  const fontDef = font ? NAME_FONT_DEFS[font] : null;
  if (font) void loadNameFont(font);

  const roleStyle = hasRoleColor(role) ? resolveRoleStyle(role) : null;
  // The role's colours win; the user's effect shows in full mode outside a coloured role.
  const effect =
    !roleStyle && mode === 'full' && style && isNameEffectId(style.effect) && style.colors?.[0]
      ? style.effect
      : null;

  const css: CSSProperties & Record<`--${string}`, string> = {};
  if (fontDef?.family) {
    css.fontFamily = fontDef.family;
    if (fontDef.weight) css.fontWeight = fontDef.weight;
    if (fontDef.scale && fontDef.scale !== 1) css.fontSize = `${fontDef.scale}em`;
    if (fontDef.letterSpacing) css.letterSpacing = fontDef.letterSpacing;
  }
  if (effect && style) {
    const [c1, c2] = style.colors;
    if (effect === 'solid') css.color = c1;
    css['--n1'] = c1!;
    css['--n2'] = c2 ?? c1!;
    // Pop's shadow: the second colour, else the stylesheet's theme-aware tint.
    if (effect === 'pop' && c2) css['--np'] = c2;
  }
  if (roleStyle) {
    if (roleStyle.kind === 'solid') css.color = roleStyle.c1;
    css['--r1'] = roleStyle.c1;
    css['--r2'] = roleStyle.c2;
  }

  return (
    <span
      className={cn('cos-name min-w-0', className)}
      data-font={font ?? undefined}
      data-effect={effect ?? undefined}
      data-role={roleStyle?.kind}
      data-play={roleStyle?.kind === 'holographic' ? animate : undefined}
      style={Object.keys(css).length ? css : undefined}
    >
      {name}
    </span>
  );
}

/** A holographic role needs no colour of its own; gradient falls back to solid without a second one. */
function resolveRoleStyle(role: RoleNameStyle): { kind: RoleColorStyle; c1: string; c2: string } {
  const c1 = role.color ?? '#a9c9ff';
  if (role.colorStyle === 'holographic')
    return { kind: 'holographic', c1, c2: role.colorSecondary ?? c1 };
  if (role.colorStyle === 'gradient' && role.colorSecondary)
    return { kind: 'gradient', c1, c2: role.colorSecondary };
  return { kind: 'solid', c1, c2: c1 };
}
