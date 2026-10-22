import { useState } from 'react';
import { CHANNEL_NAME_MAX_LENGTH, type ID } from '@enbox/shared';
import { Button, Field, Input, Modal, Switch, toast } from '@/components/ui';
import { createCategory } from '../actions';

/** Create a category (optionally private: only some roles see its channels). */
export function CategoryDialog({ spaceId, onClose }: { spaceId: ID; onClose: () => void }) {
  const [name, setName] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createCategory(spaceId, { name: name.trim(), privateRoleIds: isPrivate ? [] : undefined });
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Create category"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            Create category
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex flex-col gap-4"
      >
        <Field label="Category name" htmlFor="cat-name">
          <Input id="cat-name" value={name} maxLength={CHANNEL_NAME_MAX_LENGTH} placeholder="New category" onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Switch
          checked={isPrivate}
          onChange={setPrivate}
          label="Private category"
          description="Only you (and roles you add in its permissions later) can see its channels."
        />
      </form>
    </Modal>
  );
}
