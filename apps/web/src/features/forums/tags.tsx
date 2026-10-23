/**
 * Forum tags as Discord draws them: a pill on post cards (`TagPill`), a toggle chip in the
 * tag filter row and the tag picker (`TagToggle`), and the picker of the new-post composer
 * (`TagPicker`: a dropdown of chips; moderated tags only for moderators, at most five).
 */
import { useState } from 'react';
import { Lock, Tag as TagIcon } from 'lucide-react';
import type { ForumTag } from '@enbox/shared';
import { EmojiGlyph } from '@/components/emoji/CustomEmoji';
import { Popover } from '@/components/ui';
import { cn } from '@/lib/cn';
import { MAX_POST_TAGS } from './format';

export function TagPill({ tag, className }: { tag: ForumTag; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-surface-2 px-2 text-[12px] font-semibold text-fg',
        className,
      )}
      data-testid="forum-tag"
    >
      {tag.emoji ? <EmojiGlyph emoji={tag.emoji} size={16} /> : null}
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

export function TagToggle({
  tag,
  selected,
  disabled,
  title,
  onClick,
}: {
  tag: ForumTag;
  selected: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 max-w-60 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-45',
        selected ? 'bg-brand-soft text-brand-ink' : 'bg-surface-2 text-muted hover:bg-line hover:text-fg',
      )}
      data-testid="forum-tag-toggle"
    >
      {tag.emoji ? <EmojiGlyph emoji={tag.emoji} size={16} /> : null}
      <span className="truncate">{tag.name}</span>
      {tag.moderated ? <Lock size={12} className="shrink-0 opacity-70" aria-hidden /> : null}
    </button>
  );
}

/**
 * The composer's tag picker: a button that opens the forum's tags as chips. Moderated tags
 * are offered to moderators only; at most MAX_POST_TAGS.
 */
export function TagPicker({
  tags,
  value,
  onChange,
  moderator,
  required,
}: {
  tags: readonly ForumTag[];
  value: readonly string[];
  onChange: (ids: string[]) => void;
  moderator: boolean;
  required: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (tags.length === 0) return null;
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const full = value.length >= MAX_POST_TAGS;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] font-semibold text-muted transition-colors hover:bg-line hover:text-fg focus-visible:outline-2 focus-visible:outline-brand"
      >
        <TagIcon size={15} aria-hidden />
        {required ? 'Add Tags (required)' : 'Add Tags'}
      </button>
      <Popover
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        placement="bottom"
        align="start"
        aria-label="Tags"
        className="w-[min(360px,calc(100vw-16px))] p-3"
      >
        <p className="mb-2 text-[12px] font-bold tracking-wide text-muted uppercase">
          Select up to {MAX_POST_TAGS} tags
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Forum tags">
          {tags.map((t) => {
            const selected = value.includes(t.id);
            const locked = t.moderated && !moderator;
            return (
              <TagToggle
                key={t.id}
                tag={t}
                selected={selected}
                disabled={locked || (!selected && full)}
                title={locked ? 'Only moderators can use this tag' : undefined}
                onClick={() => toggle(t.id)}
              />
            );
          })}
        </div>
      </Popover>
    </>
  );
}
