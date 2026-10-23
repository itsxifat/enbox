/**
 * The Friends page's Active Now column (≥ 1200px, FriendsPage.tsx): a card per voice or Stage
 * channel my friends are in — the Space's icon and name, the channel, LIVE while someone
 * there streams, the people there (friends first) with "+N", and Join Voice. Clicking the card
 * opens the channel. Nothing going on: Discord's "It's quiet for now…". Live: store.ts.
 */
import { useId } from 'react';
import { useNavigate } from 'react-router';
import { Podcast, Volume2 } from 'lucide-react';
import { PERM, hasPerm, type FriendActivity, type ID } from '@enbox/shared';
import { Avatar, Button, toast } from '@/components/ui';
import { SpaceIcon } from '@/features/spaces/community/SpaceIcon';
import { connectVoice } from '@/features/voice/engine';
import { LivePill } from '@/features/voice/stream/LivePill';
import { useChat, useChats } from '@/stores/chats';
import { useSpace, useSpaces } from '@/stores/spaces';
import { useUser, useUserName } from '@/stores/users';
import { useVoice } from '@/stores/voice';
import { useActiveNow, useLiveFriendActivity } from './store';

/** Avatars on a card; the rest is "+N". */
export const CARD_AVATARS = 5;

/** Join the channel of a card (its Space's channels load first when this session has none). */
async function joinActivity(a: FriendActivity): Promise<void> {
  try {
    let chat = useChats.getState().byId[a.channelId];
    if (!chat) {
      await useSpaces.getState().loadSpace(a.spaceId);
      chat = useChats.getState().byId[a.channelId];
    }
    if (!chat) throw new Error('That channel isn’t available anymore');
    await connectVoice(chat);
  } catch (e) {
    toast.error(e);
  }
}

function PersonAvatar({ userId }: { userId: ID }) {
  const user = useUser(userId);
  const name = useUserName(userId);
  return (
    <span
      className="rounded-full ring-[3px] ring-surface-2 group-hover/card:ring-hover"
      title={name}
    >
      <Avatar src={user?.avatarUrl} name={name} colorSeed={userId} size={28} decorative />
    </span>
  );
}

function FriendName({ userId, last }: { userId: ID; last: boolean }) {
  const name = useUserName(userId);
  return (
    <>
      {name}
      {last ? null : ', '}
    </>
  );
}

function ActivityCard({ activity: a }: { activity: FriendActivity }) {
  const navigate = useNavigate();
  const space = useSpace(a.spaceId);
  const chat = useChat(a.channelId);
  const connected = useVoice((s) => s.connection?.channelId === a.channelId);
  const titleId = useId();
  // Live names when this session knows the Space and channel; the server's otherwise.
  const spaceName = space?.name ?? a.spaceName;
  const iconUrl = space ? space.iconUrl : a.spaceIconUrl;
  const channelName = chat?.name ?? a.channelName;
  const stage = a.channelType === 'space_stage';
  const shown = a.participantIds.slice(0, CARD_AVATARS);
  const more = a.participantCount - shown.length;
  const canConnect = !chat || hasPerm(chat.spacePermissions, PERM.CONNECT);
  const ChannelIcon = stage ? Podcast : Volume2;
  return (
    <li
      className="group/card relative rounded-xl bg-surface-2 p-3 transition-colors hover:bg-hover"
      aria-labelledby={titleId}
      data-testid="activity-card"
      data-animate-avatars
    >
      <button
        type="button"
        className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        aria-label={`Open ${channelName} in ${spaceName}`}
        onClick={() => void navigate(`/spaces/${a.spaceId}/${a.channelId}`)}
        data-testid="activity-open"
      />
      <div className="pointer-events-none relative flex items-center gap-3">
        <SpaceIcon name={spaceName} iconUrl={iconUrl} size={36} className="bg-surface" />
        <div className="min-w-0 flex-1 leading-tight">
          <p id={titleId} className="truncate text-[15px] font-semibold text-fg">
            {spaceName}
          </p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[13px] text-muted">
            <ChannelIcon size={14} className="shrink-0" aria-hidden />
            <span className="truncate">{channelName}</span>
            {stage ? <span className="shrink-0">· Stage</span> : null}
          </p>
        </div>
        {a.streaming ? <LivePill /> : null}
      </div>
      <p
        className="pointer-events-none relative mt-2 truncate text-[13px] text-fg"
        data-testid="activity-friends"
      >
        {a.friendIds.map((id, i) => (
          <FriendName key={id} userId={id} last={i === a.friendIds.length - 1} />
        ))}
      </p>
      <div className="pointer-events-none relative mt-2 flex items-center justify-between gap-2">
        <div
          className="flex items-center"
          role="group"
          aria-label={`${a.participantCount} in ${stage ? 'the Stage' : 'voice'}`}
        >
          <span className="flex -space-x-1.5">
            {shown.map((id) => (
              <PersonAvatar key={id} userId={id} />
            ))}
          </span>
          {more > 0 ? (
            <span
              className="ml-1.5 text-[13px] font-semibold text-muted"
              data-testid="activity-more"
            >
              +{more}
            </span>
          ) : null}
        </div>
        <Button
          size="sm"
          className="pointer-events-auto relative bg-success text-white hover:bg-success/90"
          disabled={connected || !canConnect}
          title={!canConnect ? 'You don’t have permission to connect here' : undefined}
          onClick={() => void joinActivity(a)}
          data-testid="activity-join"
        >
          {connected ? 'Connected' : stage ? 'Join Stage' : 'Join Voice'}
        </Button>
      </div>
    </li>
  );
}

export function ActiveNow() {
  useLiveFriendActivity();
  const items = useActiveNow((s) => s.items);
  const loaded = useActiveNow((s) => s.loaded);
  const headingId = useId();
  return (
    <aside
      aria-labelledby={headingId}
      className="flex w-[340px] shrink-0 flex-col overflow-y-auto px-4 pt-4 pb-4 scrollbar-thin"
      data-testid="active-now"
    >
      <h2 id={headingId} className="px-1 pb-4 text-[20px] font-bold text-fg">
        Active Now
      </h2>
      {!loaded ? null : items.length ? (
        <ul className="flex flex-col gap-2">
          {items.map((a) => (
            <ActivityCard key={a.channelId} activity={a} />
          ))}
        </ul>
      ) : (
        <div className="px-3 py-4 text-center" data-testid="active-now-empty">
          <h3 className="text-[16px] font-bold text-fg">It’s quiet for now…</h3>
          <p className="mt-1 text-[14px] leading-snug text-muted">
            When a friend starts an activity, like hanging out in voice, we’ll show it here!
          </p>
        </div>
      )}
    </aside>
  );
}
