import { useState } from 'react';
import { CHANNEL_NAME_MAX_LENGTH, type ID, type SpaceCategory } from '@enbox/shared';
import { Button, Field, Input, Modal, Switch, toast } from '@/components/ui';
import { createCategory, renameCategory } from '../actions';

/**
 * Create a category (optionally private: only some roles see its channels), or with
 * `category` edit it (Discord's Edit Category: its name).
 */
export function CategoryDialog({
  spaceId,
  category,
  onClose,
}: {
  spaceId: ID;
  category?: SpaceCategory;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = !category || name.trim() !== category.name;
  const save = async () => {
    if (!name.trim() || !dirty) return;
    setBusy(true);
    try {
      if (category) await renameCategory(spaceId, category.id, name.trim());
      else await createCategory(spaceId, { name: name.trim(), privateRoleIds: isPrivate ? [] : undefined });
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
      title={category ? 'Edit Category' : 'Create Category'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!name.trim() || !dirty} onClick={() => void save()}>
            {category ? 'Save Changes' : 'Create Category'}
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
        {!category ? (
          <Switch
            checked={isPrivate}
            onChange={setPrivate}
            label="Private category"
            description="Only you (and roles you add in its permissions later) can see its channels."
          />
        ) : null}
      </form>
    </Modal>
  );
}
