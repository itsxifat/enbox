/**
 * Moderation dialogs with an audit log reason: time out (a length), kick, ban (a message
 * deletion window) and ban by ID. `subject` is a name or "3 members"; the caller runs the
 * action (one member or a bulk request) and the dialog shows its progress and errors.
 */
import { useState } from 'react';
import type { ID, Space } from '@enbox/shared';
import { Button, Input, Modal, RadioGroup, Textarea, toast } from '@/components/ui';
import { banMember } from '@/features/spaces/actions';
import { BAN_DELETE_CHOICES, TIMEOUT_CHOICES } from './labels';

const REASON_MAX = 512;

/** Runs `action`, closing on success; errors toast and keep the dialog open. */
function useRun(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onClose();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return { busy, run };
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Textarea
      label="Reason"
      hint="Shown in the audit log."
      value={value}
      maxLength={REASON_MAX}
      rows={3}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

const reasonOf = (s: string) => s.trim() || undefined;

export function TimeoutDialog({
  subject,
  onClose,
  onTimeout,
}: {
  subject: string;
  onClose: () => void;
  onTimeout: (seconds: number, reason?: string) => Promise<void>;
}) {
  const [seconds, setSeconds] = useState<string>(String(TIMEOUT_CHOICES[2].seconds));
  const [reason, setReason] = useState('');
  const { busy, run } = useRun(onClose);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Time out ${subject}`}
      description="They can still read, but can’t send messages, react or talk until it ends."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={() => void run(() => onTimeout(Number(seconds), reasonOf(reason)))}
          >
            Time out
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <RadioGroup
          name="mod-timeout"
          label="Duration"
          value={seconds}
          onChange={setSeconds}
          options={TIMEOUT_CHOICES.map((t) => ({ value: String(t.seconds), label: t.label }))}
        />
        <ReasonField value={reason} onChange={setReason} />
      </div>
    </Modal>
  );
}

export function KickDialog({
  subject,
  onClose,
  onKick,
}: {
  subject: string;
  onClose: () => void;
  onKick: (reason?: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const { busy, run } = useRun(onClose);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Kick ${subject}?`}
      description="They can rejoin with a new invite."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() => void run(() => onKick(reasonOf(reason)))}
          >
            Kick
          </Button>
        </>
      }
    >
      <ReasonField value={reason} onChange={setReason} />
    </Modal>
  );
}

export interface BanChoice {
  reason?: string;
  deleteMessageSeconds: number;
}

export function BanDialog({
  subject,
  onClose,
  onBan,
}: {
  subject: string;
  onClose: () => void;
  onBan: (choice: BanChoice) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [purge, setPurge] = useState('0');
  const { busy, run } = useRun(onClose);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Ban ${subject}?`}
      description="They are removed and can’t rejoin, even with an invite, until unbanned."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() =>
              void run(() =>
                onBan({ reason: reasonOf(reason), deleteMessageSeconds: Number(purge) }),
              )
            }
          >
            Ban
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <RadioGroup
          name="mod-ban-purge"
          label="Delete message history"
          value={purge}
          onChange={setPurge}
          options={BAN_DELETE_CHOICES.map((c) => ({ value: String(c.seconds), label: c.label }))}
        />
        <ReasonField value={reason} onChange={setReason} />
      </div>
    </Modal>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ban someone by their user ID (members or not: they can never join). */
export function BanByIdDialog({
  space,
  onClose,
  onBanned,
}: {
  space: Space;
  onClose: () => void;
  onBanned?: (userId: ID) => void;
}) {
  const [id, setId] = useState('');
  const [reason, setReason] = useState('');
  const [purge, setPurge] = useState('0');
  const { busy, run } = useRun(onClose);
  const userId = id.trim().toLowerCase();
  const valid = UUID_RE.test(userId);
  return (
    <Modal
      open
      onClose={onClose}
      title="Ban by ID"
      description="Ban an account by its user ID, whether or not it is a member. Copy IDs with Developer Mode on."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!valid}
            onClick={() =>
              void run(async () => {
                await banMember(space.id, userId, {
                  reason: reasonOf(reason),
                  deleteMessageSeconds: Number(purge),
                });
                toast.success('Banned');
                onBanned?.(userId);
              })
            }
          >
            Ban
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="User ID"
          error={id.trim() && !valid ? 'That isn’t a user ID' : undefined}
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          autoFocus
          spellCheck={false}
        />
        <RadioGroup
          name="mod-banid-purge"
          label="Delete message history"
          value={purge}
          onChange={setPurge}
          options={BAN_DELETE_CHOICES.map((c) => ({ value: String(c.seconds), label: c.label }))}
        />
        <ReasonField value={reason} onChange={setReason} />
      </div>
    </Modal>
  );
}
