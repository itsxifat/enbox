/**
 * Space menu ▸ Privacy Settings (W7-C): whether members of this Space may DM me
 * (`SpaceMemberSelf.allowDms`, saved at once with `updateMyMember`). It counts when "Who can
 * send you direct messages" is "Members of Spaces you share"; the dialog says when it isn't.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import type { Space } from '@enbox/shared';
import { Button, Modal, Switch, toast } from '@/components/ui';
import { updateMyMember } from '@/features/spaces/actions';
import { useMe } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';

export function SpacePrivacyDialog({
  space: initial,
  onClose,
}: {
  space: Space;
  onClose: () => void;
}) {
  // Live: the Space updates under the dialog when the change lands.
  const space = useSpaces((s) => s.byId[initial.id]) ?? initial;
  const policy = useMe()?.settings.whoCanDm ?? 'everyone';
  // The value being saved shows at once; otherwise what the Space says (my other devices too).
  const [saving, setSaving] = useState<boolean | null>(null);
  const allow = saving ?? space.me.allowDms ?? true;

  const change = async (value: boolean) => {
    setSaving(value);
    try {
      await updateMyMember(space.id, { allowDms: value });
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(null);
    }
  };

  const note =
    policy === 'everyone'
      ? 'Right now anyone can send you direct messages, whatever this says.'
      : policy === 'friends'
        ? 'Right now only friends can send you direct messages, whatever this says.'
        : null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Privacy Settings"
      description={space.name}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="flex flex-col gap-3">
        <div className="card-inset flex flex-col px-3">
          <Switch
            checked={allow}
            disabled={saving !== null}
            onChange={(v) => void change(v)}
            label="Direct Messages"
            description="Allow direct messages from members of this Space."
          />
        </div>
        {note ? (
          <p className="text-[13px] text-muted" data-testid="space-privacy-note">
            {note}{' '}
            <Link
              to="/settings/privacy"
              className="font-medium text-link hover:underline"
              onClick={onClose}
            >
              Change who can message you
            </Link>
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
