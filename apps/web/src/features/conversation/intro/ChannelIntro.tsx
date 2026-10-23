/**
 * The beginning of a conversation (Discord), at the top of the message list once no older
 * messages are left:
 * - Space channels: "Welcome to #general!" and "This is the start of the #general channel.",
 *   the topic, and Edit Channel (the channel settings) with MANAGE_CHANNELS
 * - DMs: the big avatar, the name and username, "This is the beginning of your direct message
 *   history with @name.", the Spaces we share and Add / Remove Friend and Block (the friend and
 *   contact actions); my own notes chat says what it is for
 * - group DMs and groups: their picture, name and "Welcome to the beginning of the … group."
 * - threads and forum posts: their title and who started them
 */
import { Suspense, memo, useEffect, useState, type ReactNode } from 'react';
import { MessageSquare, MessagesSquare, Pencil, type LucideIcon } from 'lucide-react';
import {
  PERM,
  hasPerm,
  isVoiceChannelType,
  userDisplayName,
  type ChatSummary,
  type UserPublic,
} from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button } from '@/components/ui';
import { confirmBlock, confirmUnblock } from '@/features/contacts/contactActions';
import { GroupDmAvatar } from '@/features/groupDms/GroupDmAvatar';
import { useChatTitle } from '@/features/groupDms/title';
import {
  acceptFriend,
  addFriend,
  confirmRemoveFriend,
} from '@/features/home/friendActions';
import { useMutualSpaceCount } from '@/features/requests/actions';
import { lazyNamed } from '@/lib/lazy';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useFriendStatus, useFriends } from '@/stores/friends';
import { useUser, useUserName } from '@/stores/users';
import { RichText } from '../bubbles/RichText';
import { channelIcon } from '../channelMention/target';

const ChannelDialog = lazyNamed(
  () => import('@/features/spaces/dialogs/ChannelDialog'),
  'ChannelDialog',
);

const TITLE = 'mt-2 text-[26px] leading-8 font-bold text-fg sm:text-[32px] sm:leading-10';
const LINE = 'mt-1 text-[15px] leading-snug text-muted';

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-3 mt-4 mb-4 flex flex-col items-start lg:mx-5" data-testid="channel-intro">
      {children}
    </div>
  );
}

function IntroIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      className="flex size-[68px] items-center justify-center rounded-full bg-surface-2 text-fg"
      aria-hidden
    >
      <Icon size={40} />
    </span>
  );
}

const Strong = ({ children }: { children: ReactNode }) => (
  <strong className="font-semibold text-fg">{children}</strong>
);

function SpaceChannelIntro({ chat }: { chat: ChatSummary }) {
  const [editing, setEditing] = useState(false);
  const name = chat.name ?? 'channel';
  // Voice and Stage channels' chats name the channel without the "#".
  const label = isVoiceChannelType(chat.type) ? name : `#${name}`;
  const topic = chat.space?.topic;
  const canEdit = !!chat.space && hasPerm(chat.spacePermissions, PERM.MANAGE_CHANNELS);
  return (
    <Frame>
      <IntroIcon icon={channelIcon(chat)} />
      <h2 className={TITLE}>Welcome to {label}!</h2>
      <p className={LINE}>This is the start of the {label} channel.</p>
      {topic ? (
        <div className={`${LINE} break-words whitespace-pre-wrap`} data-testid="intro-topic">
          <RichText text={topic} />
        </div>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded text-[14px] font-medium text-link hover:underline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <Pencil size={16} aria-hidden />
          Edit Channel
        </button>
      ) : null}
      {editing && chat.space ? (
        <Suspense fallback={null}>
          <ChannelDialog spaceId={chat.space.spaceId} chat={chat} onClose={() => setEditing(false)} />
        </Suspense>
      ) : null}
    </Frame>
  );
}

function ThreadIntro({ chat }: { chat: ChatSummary }) {
  const parentId = chat.thread?.parentId;
  const post = useChats((s) => (parentId ? s.byId[parentId]?.type === 'space_forum' : false));
  const ownerId = chat.thread?.ownerId ?? null;
  const myName = useAuth((s) => s.user?.displayName ?? 'You');
  const owner = useUserName(ownerId, { you: myName });
  return (
    <Frame>
      <IntroIcon icon={post ? MessageSquare : MessagesSquare} />
      <h2 className={TITLE}>{chat.name ?? (post ? 'Post' : 'Thread')}</h2>
      {ownerId ? (
        <p className={LINE}>
          {post ? 'Posted' : 'Started'} by <Strong>{owner}</Strong>
        </p>
      ) : null}
    </Frame>
  );
}

/** "No Spaces in common", "1 Mutual Space", "3 Mutual Spaces". */
export function mutualSpacesLabel(n: number): string {
  if (!n) return 'No Spaces in common';
  return `${n} Mutual ${n === 1 ? 'Space' : 'Spaces'}`;
}

/** A button that shows its action running (the friend and block actions ask and then wait). */
function ActionButton({
  run,
  ...props
}: Omit<Parameters<typeof Button>[0], 'onClick' | 'loading'> & { run: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      {...props}
      loading={busy}
      onClick={() => {
        setBusy(true);
        void run().finally(() => setBusy(false));
      }}
    />
  );
}

function DirectActions({ peer }: { peer: UserPublic }) {
  const status = useFriendStatus(peer);
  const mutual = useMutualSpaceCount(peer.id);
  // Pending requests decide between Add Friend and Friend Request Sent.
  useEffect(() => {
    void useFriends
      .getState()
      .load()
      .catch(() => undefined);
  }, []);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {mutual !== null ? (
        <span className="mr-2 text-[14px] text-muted" data-testid="intro-mutuals">
          {mutualSpacesLabel(mutual)}
        </span>
      ) : null}
      {status === 'friend' ? (
        <ActionButton variant="secondary" run={() => confirmRemoveFriend(peer)}>
          Remove Friend
        </ActionButton>
      ) : status === 'incoming' ? (
        <ActionButton run={() => acceptFriend(peer)}>Accept Friend Request</ActionButton>
      ) : status === 'outgoing' ? (
        <Button size="sm" variant="secondary" disabled>
          Friend Request Sent
        </Button>
      ) : !peer.isBlocked ? (
        <ActionButton run={() => addFriend(peer)}>Add Friend</ActionButton>
      ) : null}
      {peer.isBlocked ? (
        <ActionButton variant="secondary" run={() => confirmUnblock(peer)}>
          Unblock
        </ActionButton>
      ) : (
        <ActionButton variant="secondary" run={() => confirmBlock(peer)}>
          Block
        </ActionButton>
      )}
    </div>
  );
}

function DirectIntro({ chat }: { chat: ChatSummary }) {
  const me = useAuth((s) => s.user?.id);
  const self = !!me && chat.peer?.id === me;
  // The live profile (block and friend changes), the summary's until it loads.
  const live = useUser(self ? null : chat.peer?.id);
  const peer = live ?? chat.peer;
  if (!peer) return null;
  const name = userDisplayName(peer);
  return (
    <Frame>
      <UserAvatar user={peer} size={80} />
      <h2 className={TITLE}>{name}</h2>
      {!peer.isDeleted ? <p className="text-[18px] font-medium text-fg">{peer.username}</p> : null}
      <p className={`${LINE} mt-3`}>
        {self ? (
          'This is your space for notes, links and reminders. They sync across your devices.'
        ) : (
          <>
            This is the beginning of your direct message history with <Strong>@{name}</Strong>.
          </>
        )}
      </p>
      {!self && !peer.isDeleted ? <DirectActions peer={peer} /> : null}
    </Frame>
  );
}

function GroupIntro({ chat }: { chat: ChatSummary }) {
  const title = useChatTitle(chat);
  return (
    <Frame>
      {chat.isGroupDm ? <GroupDmAvatar chat={chat} size={80} /> : <ChatAvatar chat={chat} size={80} />}
      <h2 className={TITLE}>{title}</h2>
      <p className={LINE}>
        {chat.type === 'channel' ? (
          <>
            This is the start of the <Strong>{title}</Strong> channel.
          </>
        ) : (
          <>
            Welcome to the beginning of the <Strong>{title}</Strong> group.
          </>
        )}
      </p>
    </Frame>
  );
}

export const ChannelIntro = memo(function ChannelIntro({ chat }: { chat: ChatSummary }) {
  if (chat.type === 'direct') return <DirectIntro chat={chat} />;
  if (chat.type === 'space_thread') return <ThreadIntro chat={chat} />;
  if (chat.space) return <SpaceChannelIntro chat={chat} />;
  return <GroupIntro chat={chat} />;
});
