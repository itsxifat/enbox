import { useCallback, useEffect, useState } from 'react';
import { Copy, Link2 } from 'lucide-react';
import {
  INVITE_MAX_AGE_OPTIONS,
  INVITE_MAX_USES_OPTIONS,
  type ID,
  type Space,
  type SpaceInvite,
} from '@enbox/shared';
import { Button, Field, Modal, Spinner, toast } from '@/components/ui';
import { copyText, inviteUrl, shownInviteUrl, useHideInvites } from '@/features/groups/shared/share';
import { createInvite } from '../actions';

const AGE_LABEL: Record<number, string> = {
  0: 'Never',
  1800: '30 minutes',
  3600: '1 hour',
  21600: '6 hours',
  43200: '12 hours',
  86400: '1 day',
  604800: '7 days',
};

/** Invite people: a fresh link (7 days, unlimited by default) with expiry and use limits. */
export function InviteDialog({ space, channelId, onClose }: { space: Space; channelId?: ID; onClose: () => void }) {
  const [maxAgeSec, setMaxAge] = useState<number>(604800);
  const [maxUses, setMaxUses] = useState<number>(0);
  const [invite, setInvite] = useState<SpaceInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const hideInvites = useHideInvites();

  const make = useCallback(async () => {
    setBusy(true);
    try {
      setInvite(
        await createInvite(space.id, {
          channelId: channelId ?? null,
          maxAgeSec: maxAgeSec as 604800,
          maxUses: maxUses as 0,
        }),
      );
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }, [space.id, channelId, maxAgeSec, maxUses]);

  useEffect(() => {
    void make();
    // A new link whenever the options change.
  }, [make]);

  const url = invite ? inviteUrl(invite.code) : '';
  const expires = invite?.expiresAt ? new Date(invite.expiresAt).toLocaleString() : null;
  return (
    <Modal open onClose={onClose} title={`Invite friends to ${space.name}`} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-2 pl-3">
          <Link2 size={18} className="shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[14px] select-all" data-testid="space-invite-url">
            {busy && !invite ? <Spinner size={16} /> : invite ? shownInviteUrl(invite.code, hideInvites) : ''}
          </span>
          <Button
            size="sm"
            leftIcon={Copy}
            disabled={!invite}
            onClick={() => void copyText(url).then((ok) => ok && toast.success('Invite link copied'))}
          >
            Copy
          </Button>
        </div>
        <p className="text-[13px] text-muted">
          {expires ? `Expires ${expires}` : 'Never expires'}
          {invite?.maxUses ? ` · ${invite.maxUses} use${invite.maxUses === 1 ? '' : 's'}` : ''}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expire after" htmlFor="inv-age">
            <select id="inv-age" value={maxAgeSec} onChange={(e) => setMaxAge(Number(e.target.value))} className="h-11 w-full rounded-xl bg-surface-2 px-3">
              {INVITE_MAX_AGE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {AGE_LABEL[s] ?? `${s}s`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Max uses" htmlFor="inv-uses">
            <select id="inv-uses" value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} className="h-11 w-full rounded-xl bg-surface-2 px-3">
              {INVITE_MAX_USES_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'No limit' : `${n} use${n === 1 ? '' : 's'}`}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
