/**
 * Outcome of adding people (group create, add members, community members): who couldn't be
 * added directly because of their privacy settings (→ send them the invite link) and who
 * failed for other reasons.
 */
import { Copy, Share2 } from 'lucide-react';
import { userDisplayName, type AddMemberFailure, type ID } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button, Modal } from '@/components/ui';
import { useUsers } from '@/stores/users';
import { copyLink, inviteUrl, shareLink } from './share';

export interface AddOutcome {
  needsInvite: ID[];
  failed: { userId: ID; reason: AddMemberFailure }[];
}

const FAILURE_TEXT: Record<AddMemberFailure, string> = {
  already_member: 'Already a member',
  not_found: 'Account not available',
  limit_reached: 'The group is full',
};

/** True when there is something to tell the user. */
export function hasProblems(r: AddOutcome | null | undefined): boolean {
  return !!r && (r.needsInvite.length > 0 || r.failed.some((f) => f.reason !== 'already_member'));
}

export function AddResultModal({
  result,
  name,
  kind,
  inviteCode,
  onClose,
}: {
  result: AddOutcome | null;
  name: string;
  kind: 'group' | 'community';
  /** Invite link code (null when the viewer can't share it). */
  inviteCode: string | null;
  onClose: () => void;
}) {
  const users = useUsers((s) => s.byId);
  if (!result) return null;
  const nameOf = (id: ID) => userDisplayName(users[id]);
  const invitees = result.needsInvite;
  const failed = result.failed.filter((f) => f.reason !== 'already_member');
  const url = inviteCode ? inviteUrl(inviteCode) : null;
  const who =
    invitees.length === 1
      ? nameOf(invitees[0]!)
      : invitees.length === 2
        ? `${nameOf(invitees[0]!)} and ${nameOf(invitees[1]!)}`
        : `${invitees.length} people`;

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={invitees.length ? `${who} can't be added directly` : 'Some people weren’t added'}
      description={
        invitees.length
          ? url
            ? `Their privacy settings only allow certain people to add them to ${kind}s. Send them an invite link instead.`
            : `Their privacy settings only allow certain people to add them to ${kind}s. Ask an admin to send them the invite link.`
          : undefined
      }
      footer={
        url && invitees.length ? (
          <>
            <Button variant="ghost" leftIcon={Copy} onClick={() => void copyLink(url)}>
              Copy link
            </Button>
            <Button
              leftIcon={Share2}
              onClick={() =>
                void shareLink({
                  title: name,
                  text: `Follow this link to join my Enbox ${kind} “${name}”`,
                  url,
                })
              }
            >
              Share invite link
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>OK</Button>
        )
      }
    >
      <ul className="-mx-2 flex flex-col pb-2" aria-label="People not added">
        {invitees.map((id) => (
          <li key={id} className="flex items-center gap-3 rounded-xl px-2 py-2">
            <UserAvatar userId={id} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-fg">{nameOf(id)}</span>
              <span className="block text-[13px] text-muted">Needs an invite link</span>
            </span>
          </li>
        ))}
        {failed.map((f) => (
          <li key={f.userId} className="flex items-center gap-3 rounded-xl px-2 py-2">
            <UserAvatar userId={f.userId} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-fg">
                {nameOf(f.userId)}
              </span>
              <span className="block text-[13px] text-danger">{FAILURE_TEXT[f.reason]}</span>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
