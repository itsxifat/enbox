import { useEffect, useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ArrowDownToLine, ArrowRightLeft, Hand, HeadphoneOff, Mic, MicOff, Podcast, UserRound, Volume2, VolumeX } from 'lucide-react';
import { PhoneOffIcon, VideoIcon } from '@/components/icons';
import { PERM, hasPerm, userDisplayName, type ChatSummary, type ID, type VoiceState } from '@enbox/shared';
import { Avatar, contextMenuAnchor, toast, type MenuAnchor, type MenuEntry } from '@/components/ui';
import { openProfile } from '@/features/profile/open';
import { tidy } from '@/features/spaces/menus';
import { cn } from '@/lib/cn';
import { inActiveDrag, pointerListeners } from '@/lib/dnd';
import { useAuth } from '@/stores/auth';
import { useSpaceAuthor } from '@/stores/spaces';
import { useUser } from '@/stores/users';
import { useVoice, useVoiceChannelStates } from '@/stores/voice';
import { disconnectVoiceMember, isStageModerator, moveVoiceMember, setStageSpeaker } from './actions';
import { useUserAudio } from './userAudio';
import { VoiceStatusLine } from './VoiceStatus';
import { VoiceUserMenu } from './VoiceUserMenu';

/** Drag data of an occupant row: the channel sidebar drops it on another voice channel. */
export interface VoiceDragData {
  kind: 'voice';
  state: VoiceState;
  /** Their name, for the drag preview and announcements. */
  label: string;
}

/**
 * The right-click menu of someone in a voice channel: their profile; on a Stage, for its
 * moderators "Invite to Speak" / "Move to Audience" (`stage`); and with MOVE_MEMBERS in that
 * channel "Move To ▸" (the other voice channels and Stages I may move people into:
 * MOVE_MEMBERS and CONNECT there) and "Disconnect".
 */
export function occupantMenuItems(o: {
  state: VoiceState;
  /** The channel they are in (my bits there decide). */
  channel: Pick<ChatSummary, 'spacePermissions'>;
  /** The Space's channels in sidebar order (only voice ones are offered). */
  channels: readonly ChatSummary[];
  onProfile: () => void;
  onMove: (channelId: ID) => void;
  onDisconnect: () => void;
  /** They are on a Stage: its seat actions (moderators; stepping down for myself). */
  stage?: { moderator: boolean; self: boolean; onInvite: () => void; onAudience: () => void };
}): MenuEntry[] {
  const canMove = hasPerm(o.channel.spacePermissions, PERM.MOVE_MEMBERS);
  const targets = o.channels.filter(
    (c) =>
      (c.type === 'space_voice' || c.type === 'space_stage') &&
      c.id !== o.state.channelId &&
      hasPerm(c.spacePermissions, PERM.MOVE_MEMBERS) &&
      hasPerm(c.spacePermissions, PERM.CONNECT),
  );
  const audience = !!o.state.suppressed;
  const invite = !!o.stage && audience && o.stage.moderator;
  const toAudience = !!o.stage && !audience && (o.stage.moderator || o.stage.self);
  return tidy([
    { label: 'Profile', icon: UserRound, onSelect: o.onProfile },
    (invite || toAudience) && 'separator',
    invite && { label: o.stage!.self ? 'Become a Speaker' : 'Invite to Speak', icon: Mic, onSelect: o.stage!.onInvite },
    toAudience && { label: 'Move to Audience', icon: ArrowDownToLine, onSelect: o.stage!.onAudience },
    canMove && 'separator',
    canMove && {
      label: 'Move To',
      icon: ArrowRightLeft,
      submenu: targets.length
        ? targets.map((c) => ({
            label: c.name ?? 'Voice',
            icon: c.type === 'space_stage' ? Podcast : Volume2,
            onSelect: () => o.onMove(c.id),
          }))
        : [{ label: 'No other voice channels', disabled: true }],
    },
    canMove && { label: 'Disconnect', icon: PhoneOffIcon, danger: true, onSelect: o.onDisconnect },
  ]);
}

function Occupant({
  chat,
  state,
  speaking,
  channels,
}: {
  chat: ChatSummary;
  state: VoiceState;
  speaking: boolean;
  channels: readonly ChatSummary[];
}) {
  const user = useUser(state.userId);
  const author = useSpaceAuthor(state.spaceId, state.userId);
  const me = useAuth((s) => s.user?.id);
  const name = author?.nickname || userDisplayName(user);
  const stage = chat.type === 'space_stage';
  const listening = stage && !!state.suppressed;
  const hand = listening && !!state.requestToSpeakAt;
  const muted = state.selfMute || state.serverMute;
  const deaf = state.selfDeaf || state.serverDeaf;
  // Muted only for me (my "Mute" in their menu).
  const mutedForMe = useUserAudio(state.userId).muted && state.userId !== me;
  const label = [
    name,
    hand ? 'asked to speak' : listening && 'listening',
    !listening && muted && 'muted',
    mutedForMe && 'muted for you',
    deaf && 'deafened',
    state.selfVideo && 'camera on',
    state.selfStream && 'live',
  ]
    .filter(Boolean)
    .join(', ');
  const canMove = hasPerm(chat.spacePermissions, PERM.MOVE_MEMBERS);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const data: VoiceDragData = { kind: 'voice', state, label: name };
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `voice:${state.userId}`, data, disabled: !canMove });
  // Pointer drags only: Space and Enter keep opening the profile; the keyboard has "Move To".
  const pointer = canMove ? pointerListeners(listeners) : null;
  const seat = (suppressed: boolean) =>
    void setStageSpeaker(state.spaceId, state.userId, suppressed).catch((e: unknown) => toast.error(e));
  const items = () =>
    occupantMenuItems({
      state,
      channel: chat,
      channels,
      onProfile: () => openProfile(state.userId, anchor, { spaceId: state.spaceId }),
      onMove: (channelId) =>
        void moveVoiceMember(state.spaceId, state.userId, channelId).catch((e: unknown) => toast.error(e)),
      onDisconnect: () =>
        void disconnectVoiceMember(state.spaceId, state.userId).catch((e: unknown) => toast.error(e)),
      stage: stage
        ? {
            moderator: isStageModerator(chat.spacePermissions),
            self: state.userId === me,
            onInvite: () => seat(false),
            onAudience: () => seat(true),
          }
        : undefined,
    });
  return (
    <li>
      <button
        ref={setNodeRef}
        type="button"
        {...pointer}
        onClick={(e) => openProfile(state.userId, e.currentTarget, { spaceId: state.spaceId })}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!inActiveDrag(e.currentTarget)) setAnchor(contextMenuAnchor(e));
        }}
        aria-label={label}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover hover:text-fg',
          listening ? 'text-subtle' : 'text-muted',
          isDragging && 'opacity-40',
        )}
        data-testid="voice-occupant"
      >
        <span className={cn('shrink-0 rounded-full ring-2 transition-shadow', speaking ? 'ring-success' : 'ring-transparent')}>
          <Avatar src={user?.avatarUrl} name={name} colorSeed={state.userId} size={24} decoration={user?.avatarDecoration} decorative />
        </span>
        <span className={cn('min-w-0 flex-1 truncate', speaking && 'text-fg')}>{name}</span>
        {hand ? <Hand size={15} className="shrink-0 text-warning" aria-hidden /> : null}
        {state.selfStream ? (
          <span className="shrink-0 rounded bg-danger px-1 text-[10px] leading-4 font-bold text-white">LIVE</span>
        ) : null}
        {state.selfVideo ? <VideoIcon size={15} className="shrink-0" aria-hidden /> : null}
        {muted && !listening ? <MicOff size={15} className={cn('shrink-0', state.serverMute && 'text-danger')} aria-hidden /> : null}
        {mutedForMe ? (
          <VolumeX size={15} className="shrink-0 text-danger" aria-hidden data-testid="muted-for-me" />
        ) : null}
        {deaf ? <HeadphoneOff size={15} className={cn('shrink-0', state.serverDeaf && 'text-danger')} aria-hidden /> : null}
      </button>
      <VoiceUserMenu
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchor={anchor}
        userId={state.userId}
        items={anchor ? items() : []}
        aria-label={`${name} menu`}
      />
    </li>
  );
}

/** The drag preview of an occupant (avatar and name). */
export function OccupantDragPreview({ data }: { data: VoiceDragData }) {
  const user = useUser(data.state.userId);
  return (
    <div className="flex h-8 w-56 items-center gap-2 rounded-md bg-elevated px-2 text-[14px] text-fg shadow-elevated">
      <Avatar src={user?.avatarUrl} name={data.label} colorSeed={data.state.userId} size={24} decorative />
      <span className="min-w-0 flex-1 truncate">{data.label}</span>
    </div>
  );
}

/**
 * Who is in a voice channel, listed under its row in the channel sidebar (Discord), after the
 * channel's status line while it has one. With MOVE_MEMBERS, a row drags onto another voice
 * channel and its menu has "Move To"; the menu of anyone else has their volume and a mute for
 * me. On a Stage, its speakers come first, then the audience (dimmed; a hand on those who
 * asked). `channels`: the Space's channels in sidebar order (the "Move To" choices).
 */
export function VoiceChannelOccupants({ chat, channels = [] }: { chat: ChatSummary; channels?: readonly ChatSummary[] }) {
  const spaceId = chat.space?.spaceId;
  useEffect(() => {
    if (spaceId)
      void useVoice
        .getState()
        .loadSpace(spaceId)
        .catch(() => undefined);
  }, [spaceId]);
  const all = useVoiceChannelStates(chat.id);
  const states = useMemo(
    () => (chat.type === 'space_stage' ? [...all.filter((v) => !v.suppressed), ...all.filter((v) => v.suppressed)] : all),
    [all, chat.type],
  );
  const speaking = useVoice((s) => s.speaking);
  const status = <VoiceStatusLine chat={chat} />;
  if (!states.length) return status;
  return (
    <>
      {status}
      <ul className="mb-1 flex flex-col pr-2 pl-7" aria-label={`In ${chat.name ?? 'voice'}`}>
        {states.map((v) => (
          <Occupant key={v.userId} chat={chat} state={v} speaking={!!speaking[v.userId]} channels={channels} />
        ))}
      </ul>
    </>
  );
}
