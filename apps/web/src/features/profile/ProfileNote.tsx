import { useEffect, useId, useRef, useState } from 'react';
import { USER_NOTE_MAX_LENGTH, type ID } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { useProfiles } from './profileStore';

/**
 * My private note about someone: a borderless textarea that grows with its text and saves
 * on blur (Enter saves too, Shift+Enter is a new line) — optimistically, via
 * `PUT /api/users/:userId/note`. Closing the card while typing (Escape unmounts it without a
 * blur) still saves. Only I can see it.
 */
export function ProfileNote({
  userId,
  className,
  labelClassName,
}: {
  userId: ID;
  className?: string;
  labelClassName?: string;
}) {
  const saved = useProfiles((s) => s.notes[userId]);
  const [draft, setDraft] = useState(saved ?? '');
  /** The draft for the unmount save (state is gone by then). */
  const draftRef = useRef(draft);
  const editing = useRef(false);
  const dirty = useRef(false);
  const id = useId();

  // The note loads after mount (and another surface may save one): adopt it unless editing.
  useEffect(() => {
    if (editing.current) return;
    draftRef.current = saved ?? '';
    setDraft(saved ?? '');
  }, [saved]);

  useEffect(
    () => () => {
      if (dirty.current) void useProfiles.getState().saveNote(userId, draftRef.current);
    },
    [userId],
  );

  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    void useProfiles.getState().saveNote(userId, draftRef.current);
  };

  return (
    <section className={className} data-testid="card-note-field">
      <label htmlFor={id} className={cn('section-label mb-1 block', labelClassName)}>
        Note
      </label>
      <textarea
        id={id}
        value={draft}
        rows={1}
        maxLength={USER_NOTE_MAX_LENGTH}
        placeholder="Click to add a note"
        aria-describedby={`${id}-hint`}
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(e) => {
          dirty.current = true;
          draftRef.current = e.target.value;
          setDraft(e.target.value);
        }}
        onBlur={() => {
          editing.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        className="-mx-1.5 block max-h-32 min-h-8 w-[calc(100%+12px)] resize-none rounded-md bg-transparent px-1.5 py-1 text-[13px] leading-snug text-fg outline-none [field-sizing:content] placeholder:text-subtle hover:bg-hover focus:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand"
      />
      <span id={`${id}-hint`} className="sr-only">
        Only you can see this note.
      </span>
    </section>
  );
}
