/**
 * Voice channel status (Discord's "Set a channel status"): what is going on in a voice or Stage
 * channel, set by people connected to it and cleared by the server once it empties.
 *
 * - `VoiceStatusLine`: one muted, truncated line under the channel's row in the sidebar.
 * - `VoiceStatusHeader`: the status in the channel's header and, for those who may set it
 *   (`canSetVoiceStatus`), a pencil opening an inline editor: an emoji button, Enter saves,
 *   Escape cancels.
 */
import { Suspense, useEffect, useRef, useState } from 'react';
import { Check, Pencil, Smile, X } from 'lucide-react';
import { VOICE_STATUS_MAX_LENGTH, type ChatSummary } from '@enbox/shared';
import { IconButton, Popover, Spinner, toast } from '@/components/ui';
import { LazyEmojiPicker } from '@/features/conversation/lazy';
import { cn } from '@/lib/cn';
import { useMyVoiceState } from '@/stores/voice';
import { canSetVoiceStatus, setVoiceChannelStatus } from './actions';

/** Under a voice channel's row in the sidebar, while it has a status. */
export function VoiceStatusLine({ chat }: { chat: Pick<ChatSummary, 'space'> }) {
  const status = chat.space?.voiceStatus;
  if (!status) return null;
  return (
    <p
      className="-mt-0.5 mb-0.5 truncate pr-2 pl-8 text-[12px] leading-4 text-muted"
      title={status}
      data-testid="voice-status-line"
    >
      {status}
    </p>
  );
}

/** In the channel header: the status, and the editor for those who may set it. */
export function VoiceStatusHeader({ chat }: { chat: ChatSummary }) {
  const mine = useMyVoiceState();
  const [editing, setEditing] = useState(false);
  const status = chat.space?.voiceStatus ?? null;
  const canSet = canSetVoiceStatus(chat, mine);
  // Left the channel (or lost the right) while editing.
  if (editing && canSet)
    return (
      <VoiceStatusEditor chat={chat} initial={status ?? ''} onDone={() => setEditing(false)} />
    );
  if (!status) {
    if (!canSet) return null;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[14px] text-subtle hover:bg-hover hover:text-muted"
      >
        <Pencil size={14} className="shrink-0" aria-hidden />
        <span className="truncate">Set a channel status</span>
      </button>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-1">
      <p
        className="min-w-0 truncate text-[14px] text-muted"
        title={status}
        data-testid="voice-status"
      >
        {status}
      </p>
      {canSet ? (
        <IconButton
          icon={Pencil}
          label="Edit channel status"
          size="sm"
          variant="ghost"
          className="shrink-0 text-muted"
          onClick={() => setEditing(true)}
        />
      ) : null}
    </div>
  );
}

function VoiceStatusEditor({
  chat,
  initial,
  onDone,
}: {
  chat: ChatSummary;
  initial: string;
  onDone: () => void;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const save = async () => {
    if (saving) return;
    if (text.trim() === initial.trim()) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      await setVoiceChannelStatus(chat.id, text);
      onDone();
    } catch (e) {
      toast.error(e);
      setSaving(false);
    }
  };

  /** Put an emoji where the caret is. */
  const insert = (emoji: string) => {
    const el = input.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    const next = (text.slice(0, start) + emoji + text.slice(end)).slice(0, VOICE_STATUS_MAX_LENGTH);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-testid="voice-status-editor"
    >
      <IconButton
        icon={Smile}
        label="Add an emoji"
        size="sm"
        variant="ghost"
        className={cn('shrink-0 text-muted', picker && 'text-fg')}
        aria-pressed={!!picker}
        onClick={(e) => setPicker(picker ? null : e.currentTarget)}
      />
      <input
        ref={input}
        value={text}
        maxLength={VOICE_STATUS_MAX_LENGTH}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onDone();
          }
        }}
        placeholder="Set a channel status"
        aria-label="Channel status"
        disabled={saving}
        className="h-8 min-w-0 flex-1 rounded-md bg-surface-2 px-2 text-[14px] text-fg outline-none placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-brand"
      />
      <IconButton
        icon={Check}
        label="Save status"
        size="sm"
        variant="ghost"
        type="submit"
        disabled={saving}
      />
      <IconButton
        icon={X}
        label="Cancel"
        size="sm"
        variant="ghost"
        onClick={onDone}
        disabled={saving}
      />
      <Popover
        open={!!picker}
        anchor={picker}
        onClose={() => setPicker(null)}
        placement="bottom"
        align="start"
        aria-label="Emoji"
      >
        <div className="h-[360px] w-[320px] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-brand-ink">
                <Spinner />
              </div>
            }
          >
            <LazyEmojiPicker
              height="100%"
              width="100%"
              onPick={(emoji) => {
                setPicker(null);
                insert(emoji);
              }}
            />
          </Suspense>
        </div>
      </Popover>
    </form>
  );
}
