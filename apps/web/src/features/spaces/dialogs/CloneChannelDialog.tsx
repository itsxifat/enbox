import { useState } from 'react';
import { useNavigate } from 'react-router';
import { CHANNEL_NAME_MAX_LENGTH, normalizeTextChannelName, type ChatSummary, type ID } from '@enbox/shared';
import { Button, Field, Input, Modal, toast } from '@/components/ui';
import { cloneChannel } from '../actions';

/** Discord's Clone Channel: a copy with the same settings and permissions, under a new name. */
export function CloneChannelDialog({ spaceId, chat, onClose }: { spaceId: ID; chat: ChatSummary; onClose: () => void }) {
  const navigate = useNavigate();
  const text = chat.type === 'space_text';
  const [name, setName] = useState(chat.name ?? '');
  const [busy, setBusy] = useState(false);
  const shown = text ? normalizeTextChannelName(name) : name.trim();
  const save = async () => {
    if (!shown) return;
    setBusy(true);
    try {
      const clone = await cloneChannel(spaceId, chat.id, shown);
      onClose();
      if (text) navigate(`/spaces/${spaceId}/${clone.id}`);
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
      title={`Clone ${chat.type === 'space_forum' ? 'Forum' : text ? 'Text' : 'Voice'} Channel`}
      description={`Same permissions, user limits and settings as ${text ? '#' : ''}${chat.name}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!shown} onClick={() => void save()} data-testid="clone-channel-save">
            Create Channel
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
        <Field label="Channel name" htmlFor="clone-name" hint={text && name && shown !== name ? `Will be #${shown}` : undefined}>
          <Input id="clone-name" value={name} maxLength={CHANNEL_NAME_MAX_LENGTH} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
      </form>
    </Modal>
  );
}
