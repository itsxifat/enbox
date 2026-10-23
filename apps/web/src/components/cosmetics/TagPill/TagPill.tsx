/**
 * A server tag as a pill: the badge in the tag's colour and the 2-4 letter tag in small bold
 * text, on a soft tint of that colour. `sm` sits in name rows (chat, member list, DMs), `md`
 * next to profile names. Built from atomic inline boxes, so a hovered name's underline skips it.
 */
import type { CSSProperties } from 'react';
import type { SpaceTag } from '@enbox/shared';
import { ICON_STROKE_BOLD } from '@/components/icons';
import { cn } from '@/lib/cn';
import { SPACE_TAG_BADGE_ICONS } from './badges';

export interface TagPillProps {
  tag: SpaceTag;
  size?: 'sm' | 'md';
  /** Native tooltip ("Tag from Rocket Club"). */
  title?: string;
  className?: string;
}

const SIZES = {
  sm: {
    box: 'h-4 rounded-[5px] px-1 text-[10.5px] leading-4',
    icon: 10,
    align: 'align-[-1px]',
    gap: 'ml-[3px]',
  },
  md: {
    box: 'h-5 rounded-md px-1.5 text-[12.5px] leading-5',
    icon: 12,
    align: 'align-[-1.5px]',
    gap: 'ml-1',
  },
} as const;

export function TagPill({ tag, size = 'sm', title, className }: TagPillProps) {
  const Icon = SPACE_TAG_BADGE_ICONS[tag.badge] ?? SPACE_TAG_BADGE_ICONS.leaf;
  const s = SIZES[size];
  // `bg-surface-2` stays where color-mix is unsupported.
  const style: CSSProperties = {
    backgroundColor: `color-mix(in srgb, ${tag.color} 16%, var(--surface-2))`,
  };
  return (
    <span
      className={cn(
        'inline-block shrink-0 bg-surface-2 align-middle font-bold tracking-[0.03em] whitespace-nowrap text-fg',
        s.box,
        className,
      )}
      style={style}
      title={title}
      data-testid="server-tag"
      data-badge={tag.badge}
    >
      <Icon
        size={s.icon}
        color={tag.color}
        strokeWidth={ICON_STROKE_BOLD}
        className={cn('inline-block', s.align)}
        aria-hidden
      />
      <span className={cn('inline-block', s.gap)}>{tag.tag}</span>
    </span>
  );
}
