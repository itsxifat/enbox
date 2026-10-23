import { useState } from 'react';
import { THREAD_NAME_MAX_LENGTH, type ChatSummary } from '@enbox/shared';
import { Button, Field, Input, Modal, toast } from '@/components/ui';
import { useThreads } from '@/stores/threads';

/** A post card's Edit Title: the title in a small dialog (its author while unlocked, moderators). */
export function EditTitleDialog({ post, onClose }: { post: ChatSummary; onClose: () => void }) {
  const [name, setName] = useState(post.name ?? '');
  const [busy, setBusy] = useState(false);
  const next = name.trim();
  const dirty = !!next && next !== post.name;
  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      await useThreads.getState().updateThread(post.id, { name: next });
      onClose();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Title"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!dirty}
            onClick={() => void save()}
            data-testid="post-title-save"
          >
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Post title" htmlFor="post-title-edit">
          <Input
            id="post-title-edit"
            value={name}
            maxLength={THREAD_NAME_MAX_LENGTH}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
