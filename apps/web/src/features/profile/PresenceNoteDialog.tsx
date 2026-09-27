/**
 * "Set a custom status": an emoji (the conversation's lazy emoji picker), text up to
 * PRESENCE_NOTE_MAX_LENGTH and when it clears (30 min / 1 h / 4 h / today / never) →
 * PUT /api/me/presence-note; "Clear status" → DELETE. Opened from my own profile card.
 */
import { Suspense, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Smile, X } from 'lucide-react';
import { PRESENCE_NOTE_MAX_LENGTH, activePresenceNote } from '@enbox/shared';
import {
  Button,
  IconButton,
  Input,
  Modal,
  RadioGroup,
  Spinner,
  toast,
  type RadioOption,
} from '@/components/ui';
import { LazyEmojiPicker } from '@/features/conversation/lazy';
import { errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { useMe } from '@/stores/auth';
import {
  NOTE_DURATIONS,
  clearPresenceNote,
  expiryFor,
  setPresenceNote,
  type NoteDuration,
} from './presenceApi';

const durationOptions: RadioOption<NoteDuration>[] = NOTE_DURATIONS.map((d) => ({
  value: d.value,
  label: d.label,
}));

export function PresenceNoteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const current = activePresenceNote(me?.presenceNote);
  const currentRef = useRef(current);
  currentRef.current = current;
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [duration, setDuration] = useState<NoteDuration>('never');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formId = useId();

  // Start from the current note each time the dialog opens (not on every `me:updated`).
  useEffect(() => {
    if (!open) return;
    setText(currentRef.current?.text ?? '');
    setEmoji(currentRef.current?.emoji ?? null);
    setDuration('never');
    setPickerOpen(false);
    setError(null);
    setBusy(false);
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed && !emoji) {
      setError('Add some text or an emoji');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setPresenceNote({ text: trimmed || null, emoji, expiresAt: expiryFor(duration) });
      toast.success('Status set');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await clearPresenceNote();
      toast.success('Status cleared');
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const counter = String(Math.max(0, PRESENCE_NOTE_MAX_LENGTH - Array.from(text).length));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Set a custom status"
      size="sm"
      initialFocus={inputRef}
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4 pt-1 pb-2">
        <div className="flex items-start gap-2">
          <button
            type="button"
            aria-label={emoji ? `Emoji: ${emoji}` : 'Pick an emoji'}
            aria-pressed={pickerOpen}
            onClick={() => setPickerOpen((v) => !v)}
            className="mt-6 flex size-11 shrink-0 items-center justify-center card-inset text-[22px] outline-none transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
            data-testid="status-emoji"
          >
            {emoji ?? <Smile size={22} className="text-muted" aria-hidden />}
          </button>
          <Input
            ref={inputRef}
            label="What's your status?"
            aside={counter}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            maxLength={PRESENCE_NOTE_MAX_LENGTH}
            placeholder="Focus time"
            error={error ?? undefined}
            autoComplete="off"
            containerClassName="min-w-0 flex-1"
          />
          {emoji ? (
            <IconButton
              icon={X}
              label="Remove emoji"
              size="sm"
              className="mt-7"
              onClick={() => setEmoji(null)}
            />
          ) : null}
        </div>
        {pickerOpen ? (
          <div className="card-inset h-[300px] overflow-hidden">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-brand-ink">
                  <Spinner />
                </div>
              }
            >
              <LazyEmojiPicker
                height="100%"
                onPick={(e) => {
                  setEmoji(e);
                  setPickerOpen(false);
                }}
              />
            </Suspense>
          </div>
        ) : null}
        <RadioGroup
          label="Clear after"
          value={duration}
          onChange={setDuration}
          options={durationOptions}
          name="note-duration"
        />
        {current?.expiresAt ? (
          <p className="text-[12.5px] text-muted">
            Your current status clears at {formatTime(current.expiresAt)}.
          </p>
        ) : null}
      </form>
      <div className="flex items-center justify-end gap-2 pt-3 pb-3">
        {current ? (
          <div className="mr-auto">
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => void clear()}
              disabled={busy}
            >
              Clear status
            </Button>
          </div>
        ) : null}
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" form={formId} loading={busy}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
