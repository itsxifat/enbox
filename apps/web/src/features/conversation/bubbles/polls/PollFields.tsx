/**
 * Fields of the poll forms (the composer's Create poll, a broadcast channel's): the duration
 * (POLL_DURATIONS_HOURS, 24 hours by default) and an answer's emoji, picked in the emoji
 * picker (`chat` brings its Space's custom emoji first, others where USE_EXTERNAL_EMOJI allows).
 */
import { Suspense, useId, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { POLL_DURATIONS_HOURS, type ChatSummary } from '@enbox/shared';
import { Button, Field, Popover, Spinner } from '@/components/ui';
import { LazyEmojiPicker } from '../../lazy';
import { ReactionEmoji } from '../reactions/ReactionEmoji';
import { pollDurationLabel } from './model';

export function PollDurationSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (hours: number) => void;
}) {
  const id = useId();
  return (
    <Field label="Duration" htmlFor={id}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-[15px] text-fg"
      >
        {POLL_DURATIONS_HOURS.map((h) => (
          <option key={h} value={h}>
            {pollDurationLabel(h)}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** The emoji button in front of an answer; its picker replaces the emoji or removes it. */
export function AnswerEmojiButton({
  index,
  emoji,
  onChange,
  chat,
}: {
  index: number;
  emoji: string | null;
  onChange: (emoji: string | null) => void;
  chat?: Pick<ChatSummary, 'space' | 'spacePermissions'>;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const pick = (next: string | null) => {
    setAnchor(null);
    onChange(next);
  };
  return (
    <>
      <button
        type="button"
        aria-label={emoji ? `Answer ${index + 1} emoji` : `Add an emoji to answer ${index + 1}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface text-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-brand"
      >
        {emoji ? <ReactionEmoji emoji={emoji} size={20} /> : <SmilePlus size={20} aria-hidden />}
      </button>
      <Popover
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        placement="bottom"
        align="start"
        aria-label="Choose an emoji"
        className="overflow-hidden"
      >
        <div className="w-[min(340px,calc(100vw-16px))]">
          <Suspense
            fallback={
              <div className="flex h-[340px] items-center justify-center text-brand-ink">
                <Spinner />
              </div>
            }
          >
            {anchor ? (
              <LazyEmojiPicker height={340} autoFocusSearch custom={chat ?? true} onPick={pick} />
            ) : null}
          </Suspense>
          {emoji ? (
            <div className="flex justify-end p-2">
              <Button variant="ghost" size="sm" onClick={() => pick(null)}>
                Remove emoji
              </Button>
            </div>
          ) : null}
        </div>
      </Popover>
    </>
  );
}
