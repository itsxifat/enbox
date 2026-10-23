/**
 * The user menus' dialogs (rendered by UserMenuHost): Add Note (my private note, the one the
 * profile card shows) and the friend nickname (the contact name I saved a friend under: it
 * shows instead of their name everywhere names show, only to me).
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  DISPLAY_NAME_MAX_LENGTH,
  USER_NOTE_MAX_LENGTH,
  userDisplayName,
  type ID,
} from '@enbox/shared';
import { Button, Input, Modal, Textarea, toast } from '@/components/ui';
import { useProfiles } from '@/features/profile/profileStore';
import { errorMessage } from '@/lib/api';
import { useContacts } from '@/stores/contacts';
import { useUser } from '@/stores/users';

export function UserNoteDialog({ userId, onClose }: { userId: ID; onClose: () => void }) {
  const user = useUser(userId);
  const saved = useProfiles((s) => s.notes[userId]);
  const [draft, setDraft] = useState<string | null>(saved === undefined ? null : (saved ?? ''));
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const field = useRef<HTMLTextAreaElement>(null);

  // The note comes with the full profile: load it when no surface did yet.
  useEffect(() => {
    if (saved !== undefined) return;
    void useProfiles
      .getState()
      .load(userId)
      .catch(() => undefined);
  }, [saved, userId]);
  useEffect(() => {
    if (draft === null && saved !== undefined) setDraft(saved ?? '');
  }, [draft, saved]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (draft === null) return;
    setBusy(true);
    const ok = await useProfiles.getState().saveNote(userId, draft);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Note"
      description={user ? `Only you can see your note about ${userDisplayName(user)}.` : undefined}
      size="sm"
      initialFocus={field}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy} disabled={draft === null}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="pt-1 pb-2">
        <Textarea
          ref={field}
          aria-label="Note"
          value={draft ?? ''}
          disabled={draft === null}
          placeholder="Click to add a note"
          maxLength={USER_NOTE_MAX_LENGTH}
          autoResize
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          data-testid="user-note-input"
        />
      </form>
    </Modal>
  );
}

/** Add / edit / reset the nickname of a friend (`PATCH /api/contacts/:id`, null = their name). */
export function FriendNicknameDialog({ userId, onClose }: { userId: ID; onClose: () => void }) {
  const user = useUser(userId);
  const [value, setValue] = useState(user?.contactName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const field = useRef<HTMLInputElement>(null);
  const had = !!user?.contactName;

  const save = async (name: string | null) => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await useContacts.getState().renameContact(user.id, name);
      toast.success(name ? 'Friend nickname saved' : 'Friend nickname reset');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = value.trim();
    void save(name && name !== user?.displayName ? name : null);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={had ? 'Edit Friend Nickname' : 'Add Friend Nickname'}
      description="Only you can see this nickname. It shows instead of their name."
      size="sm"
      initialFocus={field}
      footer={
        <>
          {had ? (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={() => void save(null)}
              disabled={busy}
            >
              Reset Nickname
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="pt-1 pb-2">
        <Input
          ref={field}
          label="Friend Nickname"
          value={value}
          placeholder={user?.displayName}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          error={error ?? undefined}
        />
      </form>
    </Modal>
  );
}
