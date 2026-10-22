import { useState } from 'react';
import { MUTE_FOREVER_ISO, isMuted, type ChatSummary, type NotifyLevel, type Space } from '@enbox/shared';
import { Button, Modal, RadioGroup, Switch, toast } from '@/components/ui';
import { patchPrefs } from '@/features/chats/chatActions';
import { updateMyMember } from '../actions';

/**
 * Notification settings: for the whole Space (no `chat`) or one channel. Levels: all
 * messages, only @mentions, nothing; channels can also follow the Space default.
 */
export function NotificationDialog({ space, chat, onClose }: { space: Space; chat?: ChatSummary; onClose: () => void }) {
  const spaceDefault: NotifyLevel = space.me.notifyLevel ?? space.defaultNotifyLevel;
  const [level, setLevel] = useState<NotifyLevel | 'default'>(chat ? (chat.notifyLevel ?? 'default') : spaceDefault);
  const [muted, setMuted] = useState(chat ? isMuted(chat.mutedUntil) : isMuted(space.me.mutedUntil));
  const [suppress, setSuppress] = useState(space.me.suppressEveryone);
  const [busy, setBusy] = useState(false);
  const label = (l: NotifyLevel) => (l === 'all' ? 'All messages' : l === 'mentions' ? 'Only @mentions' : 'Nothing');
  const options = [
    ...(chat ? [{ value: 'default' as const, label: `Use Space default (${label(spaceDefault)})` }] : []),
    { value: 'all' as const, label: 'All messages' },
    { value: 'mentions' as const, label: 'Only @mentions' },
    { value: 'none' as const, label: 'Nothing' },
  ];
  const save = async () => {
    setBusy(true);
    try {
      if (chat) {
        await patchPrefs(chat, {
          notifyLevel: level === 'default' ? null : level,
          mutedUntil: muted ? MUTE_FOREVER_ISO : null,
        });
      } else {
        await updateMyMember(space.id, {
          notifyLevel: level === 'default' ? null : level,
          mutedUntil: muted ? MUTE_FOREVER_ISO : null,
          suppressEveryone: suppress,
        });
      }
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
      title={chat ? `Notifications for #${chat.name}` : `Notifications for ${space.name}`}
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
      <div className="flex flex-col gap-4">
        <Switch checked={muted} onChange={setMuted} label={chat ? 'Mute channel' : 'Mute Space'} description="No notifications and no unread dot." />
        <RadioGroup name="notify-level" value={level} onChange={(v) => setLevel(v)} options={options} />
        {!chat ? (
          <Switch checked={suppress} onChange={setSuppress} label="Suppress @everyone and @here" description="They won’t notify you or count as mentions." />
        ) : null}
      </div>
    </Modal>
  );
}
