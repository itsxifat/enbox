/**
 * Outcome of adding people (web shared/AddResultModal.tsx): who couldn't be added directly
 * because of their privacy settings (→ send them the invite link) and who failed otherwise.
 */
import { View } from 'react-native';
import { Copy, Share2 } from 'lucide-react-native';
import { userDisplayName } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { Button, Modal, T } from '@/components/ui';
import { useUsers } from '@/stores/users';
import { useTheme } from '@/theme';
import { copyLink, inviteUrl, shareLink } from './share';

const FAILURE_TEXT = {
  already_member: 'Already a member',
  not_found: 'Account not available',
  limit_reached: 'The group is full',
};

/** True when there is something to tell the user. */
export function hasProblems(r) {
  return !!r && (r.needsInvite.length > 0 || r.failed.some((f) => f.reason !== 'already_member'));
}

export function AddResultModal({ result, name, kind, inviteCode, onClose }) {
  const { tw } = useTheme();
  const users = useUsers((s) => s.byId);
  if (!result) return null;
  const nameOf = (id) => userDisplayName(users[id]);
  const invitees = result.needsInvite;
  const failed = result.failed.filter((f) => f.reason !== 'already_member');
  const url = inviteCode ? inviteUrl(inviteCode) : null;
  const who =
    invitees.length === 1
      ? nameOf(invitees[0])
      : invitees.length === 2
        ? `${nameOf(invitees[0])} and ${nameOf(invitees[1])}`
        : `${invitees.length} people`;

  return (
    <Modal
      open
      onClose={onClose}
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
            <Button variant="ghost" leftIcon={Copy} onPress={() => void copyLink(url)}>
              Copy link
            </Button>
            <Button
              leftIcon={Share2}
              onPress={() =>
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
          <Button onPress={onClose}>OK</Button>
        )
      }
    >
      <View style={tw`-mx-2 pb-2`}>
        {invitees.map((id) => (
          <View key={id} style={tw`flex-row items-center gap-3 rounded-xl px-2 py-2`}>
            <UserAvatar userId={id} size="md" />
            <View style={tw`min-w-0 flex-1`}>
              <T numberOfLines={1} style={tw`text-[15px] font-medium`}>
                {nameOf(id)}
              </T>
              <T style={tw`text-[13px] text-muted`}>Needs an invite link</T>
            </View>
          </View>
        ))}
        {failed.map((f) => (
          <View key={f.userId} style={tw`flex-row items-center gap-3 rounded-xl px-2 py-2`}>
            <UserAvatar userId={f.userId} size="md" />
            <View style={tw`min-w-0 flex-1`}>
              <T numberOfLines={1} style={tw`text-[15px] font-medium`}>
                {nameOf(f.userId)}
              </T>
              <T style={tw`text-[13px] text-danger`}>{FAILURE_TEXT[f.reason]}</T>
            </View>
          </View>
        ))}
      </View>
    </Modal>
  );
}
