import type { PresenceNote } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { formatPresenceNote } from '@/lib/format';

export interface StatusBubbleProps {
  note: PresenceNote;
  /** The bubble's fill: the surface ring colour, so it reads as part of the card. */
  background: string;
  /** Makes it a button (my own card: edit the custom status). */
  onClick?: () => void;
  label?: string;
  className?: string;
  'data-testid'?: string;
}

/**
 * The custom status as a thought bubble beside the avatar: a rounded cloud whose two trailing
 * dots point down-left, at the avatar. Long statuses clamp to two lines.
 */
export function StatusBubble({ note, background, onClick, label, className, ...rest }: StatusBubbleProps) {
  const text = formatPresenceNote(note);
  const body = (
    <>
      <span className="line-clamp-2 break-words">{text}</span>
      <span
        aria-hidden
        className="absolute -bottom-1 -left-1 size-3 rounded-full shadow-sm"
        style={{ background }}
      />
      <span
        aria-hidden
        className="absolute -bottom-2.5 -left-3 size-1.5 rounded-full shadow-sm"
        style={{ background }}
      />
    </>
  );
  const cls = cn(
    'relative block max-w-full rounded-2xl px-3 py-1.5 text-left text-[13px] leading-snug text-fg shadow-sm',
    onClick &&
      'cursor-pointer outline-none hover:brightness-110 focus-visible:outline-2 focus-visible:outline-brand',
    className,
  );
  if (onClick)
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label ? `${label}: ${text}` : undefined}
        className={cls}
        style={{ background }}
        data-testid={rest['data-testid']}
      >
        {body}
      </button>
    );
  return (
    <div className={cls} style={{ background }} data-testid={rest['data-testid']}>
      {body}
    </div>
  );
}
