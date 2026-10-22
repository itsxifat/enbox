import { useState } from 'react';
import { useNavigate } from 'react-router';
import { SPACE_NAME_MAX_LENGTH } from '@enbox/shared';
import { Button, Field, Input, Modal, Textarea, toast } from '@/components/ui';
import { useMe } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';

/** New Space: owner + #general + a General voice channel (server defaults). */
export function CreateSpaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const n = name.trim() || `${me?.displayName ?? 'My'}’s Space`;
    setBusy(true);
    try {
      const detail = await useSpaces.getState().createSpace({
        name: n.slice(0, SPACE_NAME_MAX_LENGTH),
        description: description.trim() || undefined,
      });
      onClose();
      setName('');
      setDescription('');
      const general = detail.channels.find((c) => c.type === 'space_text');
      navigate(general ? `/spaces/${detail.space.id}/${general.id}` : `/spaces/${detail.space.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create your Space"
      description="Your Space is where you and your people hang out. Start with a text and a voice channel, add more any time."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void create()} data-testid="create-space-submit">
            Create
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        className="flex flex-col gap-4"
      >
        <Field label="Space name" htmlFor="space-name">
          <Input
            id="space-name"
            value={name}
            placeholder={`${me?.displayName ?? 'My'}’s Space`}
            maxLength={SPACE_NAME_MAX_LENGTH}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            data-testid="create-space-name"
          />
        </Field>
        <Field label="Description (optional)" htmlFor="space-desc">
          <Textarea id="space-desc" value={description} maxLength={1000} rows={3} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
