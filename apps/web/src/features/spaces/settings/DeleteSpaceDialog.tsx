import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Space } from '@enbox/shared';
import { Button, Field, Input, Modal, toast } from '@/components/ui';
import { deleteSpace } from '../actions';

/** Discord's Delete Server: the owner types the Space's name to confirm. */
export function DeleteSpaceDialog({ space, onClose }: { space: Space; onClose: () => void }) {
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === space.name.trim();
  const remove = async () => {
    if (!matches) return;
    setBusy(true);
    try {
      await deleteSpace(space.id);
      onClose();
      navigate('/spaces', { replace: true });
      toast.success(`${space.name} was deleted`);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete ‘${space.name}’`}
      description="Every channel, message, role and invite of this Space is deleted for everyone. This cannot be undone."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} disabled={!matches} onClick={() => void remove()} data-testid="delete-space-confirm">
            Delete Space
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void remove();
        }}
      >
        <Field label="Enter the Space name" htmlFor="delete-space-name">
          <Input id="delete-space-name" value={typed} placeholder={space.name} autoComplete="off" onChange={(e) => setTyped(e.target.value)} autoFocus />
        </Field>
      </form>
    </Modal>
  );
}
