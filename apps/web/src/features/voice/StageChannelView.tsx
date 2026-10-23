/**
 * /spaces/:spaceId/:chatId for a Stage channel (Discord's Stage): a header with the Stage's
 * name and topic; while I am connected, the speakers (big avatars, speaking rings, mic state),
 * the raised hands for moderators ("Requests to Speak", each with Invite to Speak), the
 * audience (small avatars, a hand on those who asked) and the bar of my role:
 * - audience: Request to Speak (a toggle; moderators: Become a Speaker) and Leave Quietly
 * - speakers: mic, soundboard, Move to Audience and Leave Quietly
 * Right-clicking someone opens the Stage menu (stageMenu.ts: Invite to Speak / Move to
 * Audience for moderators) with their volume and a mute for me (VoiceUserMenu). Speakers and
 * moderators set the Stage's status in the header. Not connected: the lobby with Join Stage —
 * everyone joins in the audience; the voice engine publishes nothing there and turns the mic
 * on once invited up.
 */
import { useEffect, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { ArrowDownToLine, ArrowLeft, Hand, Mic, MicOff, Podcast, Volume2, VolumeX } from 'lucide-react';
import { PhoneOffIcon } from '@/components/icons';
import { PERM, hasPerm, type ChatSummary, type ID, type Space, type VoiceState } from '@enbox/shared';
import { Avatar, Button, IconButton, contextMenuAnchor, toast, type MenuAnchor } from '@/components/ui';
import { openProfile } from '@/features/profile/open';
import { SoundboardButton } from '@/features/soundboard/SoundboardButton';
import { SoundFlash } from '@/features/soundboard/SoundFlash';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { useStageGroups, useVoice } from '@/stores/voice';
import { useVoiceSelf } from '@/stores/voiceSelf';
import { isStageModerator, requestToSpeak, setStageSpeaker } from './actions';
import { connectVoice, disconnectVoice, resumeVoiceAudio, voiceAvailable } from './engine';
import { stageMemberMenuItems } from './stageMenu';
import { useUserAudio } from './userAudio';
import { useVoiceUser } from './useVoiceUser';
import { VoiceStatusHeader } from './VoiceStatus';
import { VoiceUserMenu } from './VoiceUserMenu';

const fail = (e: unknown) => toast.error(e);

type OpenMenu = (state: VoiceState, e: MouseEvent<HTMLElement>) => void;

function SpeakerTile({ state, onMenu }: { state: VoiceState; onMenu: OpenMenu }) {
  const { name, user } = useVoiceUser(state.spaceId, state.userId);
  const speaking = useVoice((s) => !!s.speaking[state.userId]);
  const me = useAuth((s) => s.user?.id);
  const muted = state.selfMute || state.serverMute;
  // Muted only for me (my "Mute" in their menu).
  const mutedForMe = useUserAudio(state.userId).muted && state.userId !== me;
  return (
    <li className="relative">
      <button
        type="button"
        onClick={(e) => openProfile(state.userId, e.currentTarget, { spaceId: state.spaceId })}
        onContextMenu={(e) => onMenu(state, e)}
        aria-label={[name, muted && 'muted', mutedForMe && 'muted for you', speaking && 'speaking']
          .filter(Boolean)
          .join(', ')}
        className="flex w-full flex-col items-center gap-2 rounded-xl bg-surface-2 px-2 py-4 text-center transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
        data-testid="stage-speaker"
        data-animate-avatars
      >
        <span className={cn('relative rounded-full ring-[3px] transition-shadow', speaking ? 'ring-success' : 'ring-transparent')}>
          <Avatar
            src={user?.avatarUrl}
            animatedSrc={user?.avatarAnimatedUrl}
            name={name}
            colorSeed={state.userId}
            size={80}
            decoration={user?.avatarDecoration}
            decorative
          />
          <span
            className={cn(
              'absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-full ring-4 ring-surface-2',
              muted ? 'bg-danger-fill text-white' : 'bg-surface text-muted',
            )}
            aria-hidden
          >
            {muted ? <MicOff size={14} /> : <Mic size={14} />}
          </span>
        </span>
        <span className="flex w-full min-w-0 items-center justify-center gap-1">
          {mutedForMe ? (
            <VolumeX size={14} className="shrink-0 text-danger" aria-hidden data-testid="muted-for-me" />
          ) : null}
          <span className="truncate text-[14px] font-semibold text-fg">{name}</span>
        </span>
      </button>
      <SoundFlash userId={state.userId} />
    </li>
  );
}

function AudienceTile({ state, onMenu }: { state: VoiceState; onMenu: OpenMenu }) {
  const { name, user } = useVoiceUser(state.spaceId, state.userId);
  const hand = !!state.requestToSpeakAt;
  return (
    <li>
      <button
        type="button"
        onClick={(e) => openProfile(state.userId, e.currentTarget, { spaceId: state.spaceId })}
        onContextMenu={(e) => onMenu(state, e)}
        aria-label={hand ? `${name}, asked to speak` : name}
        className="flex w-20 flex-col items-center gap-1 rounded-lg p-1.5 text-center hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
        data-testid="stage-listener"
      >
        <span className="relative">
          <Avatar src={user?.avatarUrl} name={name} colorSeed={state.userId} size={48} decoration={user?.avatarDecoration} decorative />
          {hand ? (
            <span
              className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full bg-warning text-white ring-2 ring-surface"
              aria-hidden
              data-testid="raised-hand"
            >
              <Hand size={13} />
            </span>
          ) : null}
        </span>
        <span className="w-full truncate text-[12px] text-muted">{name}</span>
      </button>
    </li>
  );
}

function RequestRow({ state }: { state: VoiceState }) {
  const { name, user } = useVoiceUser(state.spaceId, state.userId);
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-1.5">
      <Avatar src={user?.avatarUrl} name={name} colorSeed={state.userId} size={32} decorative />
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{name}</span>
      <Button size="sm" variant="soft" leftIcon={Mic} onClick={() => void setStageSpeaker(state.spaceId, state.userId, false).catch(fail)}>
        Invite to Speak
      </Button>
    </li>
  );
}

/** Moderators: the raised hands, the earliest first. */
function Requests({ requests }: { requests: VoiceState[] }) {
  return (
    <section className="card-inset flex flex-col gap-1 p-3" aria-label="Requests to speak" data-testid="stage-requests">
      <h2 className="section-label flex items-center gap-1.5 px-2">
        <Hand size={14} aria-hidden /> Requests to Speak — {requests.length}
      </h2>
      {requests.length ? (
        <ul className="flex flex-col">
          {requests.map((v) => (
            <RequestRow key={v.userId} state={v} />
          ))}
        </ul>
      ) : (
        <p className="px-2 py-1 text-[13px] text-muted">No one has asked to speak yet.</p>
      )}
    </section>
  );
}

function StageBar({ chat, mine, moderator }: { chat: ChatSummary; mine: VoiceState | undefined; moderator: boolean }) {
  const { muted, deafened, toggleMute } = useVoiceSelf();
  const spaceId = chat.space!.spaceId;
  const btn = 'size-12 rounded-full';
  const leave = (
    <Button variant="danger" leftIcon={PhoneOffIcon} onClick={() => void disconnectVoice()} data-testid="stage-leave">
      Leave Quietly
    </Button>
  );
  if (!mine) return null;
  if (mine.suppressed) {
    const raised = !!mine.requestToSpeakAt;
    return (
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 px-3 pb-4" role="toolbar" aria-label="Stage controls">
        {moderator ? (
          <Button leftIcon={Mic} onClick={() => void setStageSpeaker(spaceId, mine.userId, false).catch(fail)}>
            Become a Speaker
          </Button>
        ) : (
          <Button
            variant={raised ? 'primary' : 'secondary'}
            leftIcon={Hand}
            aria-pressed={raised}
            disabled={!hasPerm(chat.spacePermissions, PERM.SPEAK)}
            onClick={() => void requestToSpeak(spaceId, mine.userId, !raised).catch(fail)}
            data-testid="request-to-speak"
          >
            {raised ? 'Hand Raised' : 'Request to Speak'}
          </Button>
        )}
        {leave}
      </div>
    );
  }
  const off = muted || deafened;
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 px-3 pb-4" role="toolbar" aria-label="Stage controls">
      <IconButton
        icon={off ? MicOff : Mic}
        label={off ? 'Unmute' : 'Mute'}
        variant="solid"
        className={cn(btn, off && 'text-danger')}
        onClick={toggleMute}
      />
      <SoundboardButton look="bar" />
      <Button variant="secondary" leftIcon={ArrowDownToLine} onClick={() => void setStageSpeaker(spaceId, mine.userId, true).catch(fail)}>
        Move to Audience
      </Button>
      {leave}
    </div>
  );
}

/** Connected: speakers, requests (moderators), the audience and my bar. */
function StageRoom({ chat, space }: { chat: ChatSummary; space: Space }) {
  const me = useAuth((s) => s.user?.id);
  const { speakers, audience, requests } = useStageGroups(chat.id);
  const audioBlocked = useVoice((s) => s.audioBlocked);
  const moderator = isStageModerator(chat.spacePermissions);
  const mine = [...speakers, ...audience].find((v) => v.userId === me);
  const [menu, setMenu] = useState<{ state: VoiceState; anchor: MenuAnchor } | null>(null);
  const onMenu: OpenMenu = (state, e) => {
    e.preventDefault();
    setMenu({ state, anchor: contextMenuAnchor(e) });
  };
  const items = menu
    ? stageMemberMenuItems({
        state: menu.state,
        moderator,
        self: menu.state.userId === me,
        onProfile: () => openProfile(menu.state.userId, menu.anchor, { spaceId: space.id }),
        onInvite: () => void setStageSpeaker(space.id, menu.state.userId, false).catch(fail),
        onAudience: () => void setStageSpeaker(space.id, menu.state.userId, true).catch(fail),
      })
    : [];
  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin">
        {audioBlocked ? (
          <div className="sticky top-0 z-10 flex justify-center py-2">
            <Button leftIcon={Volume2} onClick={() => void resumeVoiceAudio()}>
              Click to hear the Stage
            </Button>
          </div>
        ) : null}
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <section aria-label="Speakers">
            <h2 className="section-label pb-2">Speakers — {speakers.length}</h2>
            {speakers.length ? (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {speakers.map((v) => (
                  <SpeakerTile key={v.userId} state={v} onMenu={onMenu} />
                ))}
              </ul>
            ) : (
              <p className="card-inset p-4 text-center text-[14px] text-muted">
                {moderator ? 'No one is speaking. Invite someone up, or become a speaker.' : 'No one is speaking yet.'}
              </p>
            )}
          </section>
          {moderator ? <Requests requests={requests} /> : null}
          <section aria-label="Audience">
            <h2 className="section-label pb-2">Audience — {audience.length}</h2>
            {audience.length ? (
              <ul className="flex flex-wrap gap-1">
                {audience.map((v) => (
                  <AudienceTile key={v.userId} state={v} onMenu={onMenu} />
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">No one is listening yet.</p>
            )}
          </section>
        </div>
      </div>
      <StageBar chat={chat} mine={mine} moderator={moderator} />
      <VoiceUserMenu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchor={menu?.anchor ?? null}
        userId={menu?.state.userId}
        items={items}
        aria-label="Stage member menu"
      />
    </>
  );
}

function LobbyAvatar({ spaceId, userId }: { spaceId: ID; userId: ID }) {
  const { name, user } = useVoiceUser(spaceId, userId);
  return (
    <span className="rounded-full ring-4 ring-surface" title={name}>
      <Avatar src={user?.avatarUrl} name={name} colorSeed={userId} size={48} decoration={user?.avatarDecoration} decorative />
    </span>
  );
}

/** Not connected: who is on stage, how many listen, and Join Stage. */
function StageLobby({ chat, space }: { chat: ChatSummary; space: Space }) {
  const { speakers, audience } = useStageGroups(chat.id);
  const canConnect = hasPerm(chat.spacePermissions, PERM.CONNECT);
  const total = speakers.length + audience.length;
  const full = !!chat.space?.userLimit && total >= chat.space.userLimit && !hasPerm(chat.spacePermissions, PERM.MOVE_MEMBERS);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
        <Podcast size={30} aria-hidden />
      </span>
      <h2 className="text-[24px] font-bold text-fg">{chat.name}</h2>
      {chat.space?.topic ? <p className="max-w-md text-[15px] text-muted">{chat.space.topic}</p> : null}
      {speakers.length ? (
        <div className="flex -space-x-2" aria-label={`${speakers.length} speaking`}>
          {speakers.slice(0, 8).map((v) => (
            <LobbyAvatar key={v.userId} spaceId={space.id} userId={v.userId} />
          ))}
        </div>
      ) : null}
      <p className="text-[14px] text-muted" data-testid="stage-counts">
        {speakers.length === 1 ? '1 speaker' : `${speakers.length} speakers`} · {audience.length} listening
      </p>
      {!voiceAvailable() ? (
        <p className="max-w-sm text-[14px] text-muted">Voice channels aren’t switched on for this server yet.</p>
      ) : !canConnect ? (
        <p className="text-[14px] text-muted">You don’t have permission to join this Stage.</p>
      ) : full ? (
        <p className="text-[14px] text-muted">This Stage is full.</p>
      ) : (
        <>
          <Button onClick={() => void connectVoice(chat)} data-testid="join-stage">
            Join Stage
          </Button>
          <p className="text-[13px] text-subtle">You’ll join as a listener.</p>
        </>
      )}
    </div>
  );
}

/** /spaces/:spaceId/:chatId for a Stage channel: the lobby, or the Stage while I am on it. */
export function StageChannelView({ chat, space }: { chat: ChatSummary; space: Space }) {
  useEffect(() => {
    void useVoice
      .getState()
      .loadSpace(space.id)
      .catch(() => undefined);
  }, [space.id]);
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const here = useVoice((s) => s.connection?.channelId === chat.id);
  const status = useVoice((s) => (s.connection?.channelId === chat.id ? s.connection.status : null));
  const topic = chat.space?.topic;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="stage-channel">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3">
        {desktop ? null : (
          <IconButton icon={ArrowLeft} label="Back" variant="ghost" onClick={() => navigate(`/spaces/${space.id}`)} />
        )}
        <Podcast size={22} className="shrink-0 text-muted" aria-hidden />
        <h1 className="shrink-0 truncate text-[16px] font-bold">{chat.name}</h1>
        {topic ? (
          <p className="hidden min-w-0 flex-1 truncate text-[14px] text-muted sm:block" title={topic} data-testid="stage-topic">
            {topic}
          </p>
        ) : null}
        <div className={cn('flex min-w-0 justify-end', !topic && 'flex-1 justify-start')}>
          <VoiceStatusHeader chat={chat} />
        </div>
        {status && status !== 'connected' ? (
          <span className="shrink-0 text-[13px] text-warning">{status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>
        ) : null}
      </header>
      {here ? <StageRoom chat={chat} space={space} /> : <StageLobby chat={chat} space={space} />}
    </div>
  );
}
