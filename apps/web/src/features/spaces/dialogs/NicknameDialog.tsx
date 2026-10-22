import { useState } from 'react';
import { NICKNAME_MAX_LENGTH, type Space } from '@enbox/shared';
import { Button, Field, Input, Modal, toast } from '@/components/ui';
import { useMe } from '@/stores/auth';
import { updateMyMember } from '../actions';

/** My nickname in this Space (Discord's "Edit Server Profile"). */
export function NicknameDialog({ space, onClose }: { space: Space; onClose: () => void }) {
  const me = useMe();
  const [value, setValue] = useState(space.me.nickname ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await updateMyMember(space.id, { nickname: value.trim() || null });
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
      title={`Your profile in ${space.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Nickname" htmlFor="my-nick" hint="Only in this Space. Leave empty to use your name.">
        <Input id="my-nick" value={value} maxLength={NICKNAME_MAX_LENGTH} placeholder={me?.displayName} onChange={(e) => setValue(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}
