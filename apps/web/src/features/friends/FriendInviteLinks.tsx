import { useEffect, useState } from 'react';
import { Copy, Link2 } from 'lucide-react';
import { FRIEND_INVITE_MAX_USES, FRIEND_INVITE_TTL_DAYS, type FriendInvite } from '@enbox/shared';
import { Button, confirm, toast } from '@/components/ui';
import { INVITE_HIDDEN_TEXT, copyLink, useHideInvites } from '@/features/groups/shared/share';
import { createFriendInvite, friendInviteUrl, listFriendInvites, revokeFriendInvites } from './api';

/** "Expires in 6 days" (hours, then minutes, near the end). */
export function expiresInText(expiresAt: string, now = Date.now()): string {
  const ms = Math.max(0, Date.parse(expiresAt) - now);
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `Expires in ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `Expires in ${hours} hour${hours === 1 ? '' : 's'}`;
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return `Expires in ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** "3 of 5 uses left". */
export function usesLeftText(invite: Pick<FriendInvite, 'uses' | 'maxUses'>): string {
  return `${invite.maxUses - invite.uses} of ${invite.maxUses} uses left`;
}

/**
 * "Or share a link" on the Add Friend tab: my newest live friend invite link (whoever opens it
 * becomes my friend; a week or five uses) with Copy, when it expires and the uses left, a new
 * link, and Revoke all (every link of mine stops working). Streamer Mode hides the link on
 * screen; Copy still copies it.
 */
export function FriendInviteLinks() {
  const [invites, setInvites] = useState<FriendInvite[] | null>(null);
  const [busy, setBusy] = useState<'create' | 'revoke' | null>(null);
  const hidden = useHideInvites();

  useEffect(() => {
    let alive = true;
    listFriendInvites()
      .then((list) => alive && setInvites(Array.isArray(list) ? list : []))
      .catch(() => alive && setInvites([]));
    return () => {
      alive = false;
    };
  }, []);

  const create = async () => {
    setBusy('create');
    try {
      const invite = await createFriendInvite();
      setInvites((list) => [invite, ...(list ?? [])]);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    const ok = await confirm({
      title: 'Revoke your invite links?',
      message: 'Links you shared stop working. Anyone who already used one stays your friend.',
      confirmLabel: 'Revoke all',
      danger: true,
    });
    if (!ok) return;
    setBusy('revoke');
    try {
      await revokeFriendInvites();
      setInvites([]);
      toast.success('Invite links revoked');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const latest = invites?.[0] ?? null;
  const url = latest ? friendInviteUrl(latest.code) : '';
  return (
    <section
      aria-labelledby="friend-invite-heading"
      className="mt-8"
      data-testid="friend-invite-links"
    >
      <h2 id="friend-invite-heading" className="text-[16px] font-bold text-fg uppercase">
        Or share a link
      </h2>
      <p className="mt-1 text-[14px] text-muted">
        Anyone who opens your link becomes your friend. It works for {FRIEND_INVITE_TTL_DAYS} days
        or {FRIEND_INVITE_MAX_USES} people.
      </p>
      {invites === null ? null : latest ? (
        <>
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-surface-2 p-2 pl-3">
            <Link2 size={18} className="shrink-0 text-muted" aria-hidden />
            <span
              className="min-w-0 flex-1 truncate text-[14.5px] text-fg"
              data-testid="friend-invite-url"
            >
              {hidden ? INVITE_HIDDEN_TEXT : url}
            </span>
            <Button size="sm" leftIcon={Copy} onClick={() => void copyLink(url, 'Invite link')}>
              Copy
            </Button>
          </div>
          <p className="mt-2 text-[13px] text-muted" data-testid="friend-invite-meta">
            {expiresInText(latest.expiresAt)} · {usesLeftText(latest)}
            {invites.length > 1 ? ` · ${invites.length} active links` : ''}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="soft"
              loading={busy === 'create'}
              disabled={!!busy}
              onClick={() => void create()}
            >
              New link
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              loading={busy === 'revoke'}
              disabled={!!busy}
              onClick={() => void revoke()}
            >
              Revoke all
            </Button>
          </div>
        </>
      ) : (
        <Button
          className="mt-4"
          leftIcon={Link2}
          loading={busy === 'create'}
          onClick={() => void create()}
        >
          Create Invite Link
        </Button>
      )}
    </section>
  );
}
