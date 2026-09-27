/**
 * Discord-style profile card: banner (or the profile-colour gradient), avatar with the presence
 * badge, name / saved name, @username · pronouns, the custom status, "About me" (bio), about,
 * member since, groups in common and the actions — Message / Voice / Video / Add contact /
 * Block / View full profile for others; availability, custom status and Edit profile on my
 * own card. Rendered by ProfilePopover (popover / sheet) and, in `preview` mode (no
 * actions), at the top of Settings → Profile.
 *
 * Privacy: fields the subject hides arrive as null and are simply not rendered; missing
 * colours fall back to the brand gradient. An animated avatar / banner plays here (the card
 * is the one place with `animate: 'always'`), never under reduced motion or the 'never' pref.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Ban, MessageCircle, Pencil, Smile, UserPlus, UserRoundX } from 'lucide-react';
import {
  activePresenceNote,
  chatTitle,
  userDisplayName,
  type ChatSummary,
  type Presence,
  type PresenceNote,
  type UserPublic,
} from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { presenceBadge } from '@/components/common/UserAvatar';
import { PhoneIcon, VideoIcon } from '@/components/icons';
import { Avatar, Button, IconButton, Skeleton, toast } from '@/components/ui';
import { confirmBlock, confirmUnblock, openDirectChat } from '@/features/contacts/contactActions';
import { useAppVisible } from '@/hooks/useAppVisible';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMonthYear, formatPresenceNote, presenceLabel } from '@/lib/format';
import { useCalls } from '@/stores/calls';
import { useChats } from '@/stores/chats';
import { useUi } from '@/stores/ui';
import { AvailabilityPicker } from './AvailabilityPicker';
import { profileGradient, type ProfileCardUser } from './model';

export interface ProfileCardProps {
  user: ProfileCardUser;
  /** Live presence (the caller subscribes); falls back to `user.presenceState/presenceNote`. */
  presence?: Presence | null;
  /** My own card: availability, custom status and Edit profile instead of the contact actions. */
  self?: boolean;
  /** Settings preview: no actions. */
  preview?: boolean;
  /** Groups in common: null while loading; omit to hide the section. */
  commonGroups?: ChatSummary[] | null;
  /** Called right before the card navigates somewhere (the host closes the popover). */
  onNavigate?: () => void;
  /** Self card: open the custom-status dialog (rendered by the host, outside the popover). */
  onSetStatus?: () => void;
  /** Add / edit contact dialog (rendered by the host, outside the popover). */
  onEditContact?: (user: UserPublic) => void;
  className?: string;
}

const LABEL = 'section-label mb-1';
const LINK =
  'inline-flex items-center gap-1 rounded text-brand-ink hover:underline focus-visible:outline-2 focus-visible:outline-brand';
const ROW =
  'card-inset flex min-h-11 w-full items-center gap-3 px-3 py-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand';

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export function ProfileCard({
  user,
  presence,
  self = false,
  preview = false,
  commonGroups,
  onNavigate,
  onSetStatus,
  onEditContact,
  className,
}: ProfileCardProps) {
  const reduceMotion = useReducedMotion();
  const autoplay = useUi((s) => s.prefs.autoplayAnimatedMedia);
  const appVisible = useAppVisible();
  const playBanner =
    !!user.bannerAnimatedUrl && !reduceMotion && autoplay !== 'never' && appVisible;
  const banner = mediaUrl(playBanner ? user.bannerAnimatedUrl : user.bannerUrl);
  const deleted = user.isDeleted;
  const state = deleted ? null : presence ? presenceBadge(presence) : user.presenceState;
  const note = deleted ? null : activePresenceNote(presence ? presence.note : user.presenceNote);
  const name = userDisplayName(user);
  const alias =
    !deleted && user.contactName && user.contactName !== user.displayName ? user.displayName : null;

  return (
    <div
      className={cn('flex flex-col overflow-hidden bg-elevated text-left', className)}
      data-testid="profile-card"
      data-user-id={user.id}
    >
      <div
        className="relative w-full shrink-0"
        style={{
          aspectRatio: '5 / 2',
          background: profileGradient(user.profileColor, user.accentColor),
          borderBottom: user.accentColor ? `3px solid ${user.accentColor}` : undefined,
        }}
        data-testid="card-banner"
      >
        {banner ? (
          <img src={banner} alt="" className="size-full object-cover" draggable={false} />
        ) : null}
      </div>
      <div className="px-4">
        <span className="-mt-10 inline-flex rounded-full bg-elevated ring-[6px] ring-elevated">
          <Avatar
            src={deleted ? null : user.avatarUrl}
            animatedSrc={deleted ? null : user.avatarAnimatedUrl}
            animate="always"
            name={name}
            colorSeed={user.id}
            size={80}
            presence={state}
            decorative={false}
          />
        </span>
      </div>
      <div className="flex flex-col gap-3 px-4 pt-2 pb-4">
        <div className="card-inset min-w-0 px-3 py-2.5">
          <h2
            className="truncate text-[19px] leading-tight font-semibold text-fg"
            data-testid="card-name"
          >
            {name}
          </h2>
          {alias ? <p className="truncate text-[13.5px] text-muted">~{alias}</p> : null}
          {!deleted ? (
            <p className="truncate text-[13.5px] text-muted">
              @{user.username}
              {user.pronouns ? (
                <>
                  {' · '}
                  <span data-testid="card-pronouns">{user.pronouns}</span>
                </>
              ) : null}
            </p>
          ) : null}
          {state && state !== 'offline' ? (
            <p className="mt-1 text-[12.5px] text-subtle" data-testid="card-state">
              {capitalize(presenceLabel(state))}
            </p>
          ) : null}
          {note ? (
            <p
              className="mt-2 inline-block max-w-full rounded-lg bg-elevated px-2.5 py-1.5 text-[13.5px] break-words text-fg"
              data-testid="card-note"
            >
              {formatPresenceNote(note)}
            </p>
          ) : null}
        </div>

        {user.bio ? (
          <section>
            <h3 className={LABEL}>About me</h3>
            <p
              className="text-[14px] leading-relaxed break-words whitespace-pre-wrap text-fg"
              data-testid="card-bio"
            >
              {user.bio}
            </p>
          </section>
        ) : null}
        {user.about ? (
          <section>
            <h3 className={LABEL}>About</h3>
            <p className="text-[14px] break-words text-fg" data-testid="card-about">
              {user.about}
            </p>
          </section>
        ) : null}
        {user.createdAt ? (
          <section>
            <h3 className={LABEL}>Member since</h3>
            <p className="text-[14px] text-fg" data-testid="card-member-since">
              {formatMonthYear(user.createdAt)}
            </p>
          </section>
        ) : null}
        {commonGroups !== undefined && !self && !deleted ? (
          <CommonGroups groups={commonGroups} onNavigate={onNavigate} />
        ) : null}

        {preview ? null : deleted ? (
          <p className="flex items-center gap-2 text-[13px] text-muted">
            <UserRoundX size={16} aria-hidden /> This account was deleted.
          </p>
        ) : self ? (
          <SelfActions note={note} onNavigate={onNavigate} onSetStatus={onSetStatus} />
        ) : (
          <UserActions user={user} onNavigate={onNavigate} onEditContact={onEditContact} />
        )}
      </div>
    </div>
  );
}

function CommonGroups({
  groups,
  onNavigate,
}: {
  groups: ChatSummary[] | null;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  if (groups === null) return <Skeleton className="h-4 w-36" />;
  if (!groups.length) return null;
  const shown = groups.slice(0, 3);
  return (
    <section data-testid="card-common-groups">
      <h3 className={LABEL}>
        {groups.length === 1 ? '1 group in common' : `${groups.length} groups in common`}
      </h3>
      <ul className="-mx-1 flex flex-col">
        {shown.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => {
                onNavigate?.();
                void navigate(`/chats/${g.id}`);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left outline-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
            >
              <ChatAvatar chat={g} size="xs" />
              <span className="truncate text-[13.5px] text-fg">{chatTitle(g)}</span>
            </button>
          </li>
        ))}
        {groups.length > shown.length ? (
          <li className="px-1 pt-0.5 text-[12.5px] text-muted">
            and {groups.length - shown.length} more
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function UserActions({
  user,
  onNavigate,
  onEditContact,
}: {
  user: UserPublic;
  onNavigate?: () => void;
  onEditContact?: (user: UserPublic) => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'message' | 'audio' | 'video' | null>(null);
  // The cached direct chat (if any) says whether calls are allowed (`permissions.canCall`).
  const directChat = useChats((s) =>
    Object.values(s.byId).find((c) => c.type === 'direct' && c.peer?.id === user.id),
  );
  const canCall = directChat ? directChat.permissions.canCall : !user.isBlocked;

  const message = async () => {
    setBusy('message');
    try {
      const chat = await openDirectChat(user.id);
      onNavigate?.();
      void navigate(`/chats/${chat.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const call = async (type: 'audio' | 'video') => {
    setBusy(type);
    try {
      const chat = directChat ?? (await openDirectChat(user.id));
      if (!chat.permissions.canCall) {
        toast.error("You can't call this person.");
        return;
      }
      onNavigate?.();
      void useCalls.getState().startCall(chat.id, type);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          leftIcon={MessageCircle}
          fullWidth
          loading={busy === 'message'}
          disabled={!!busy}
          onClick={() => void message()}
        >
          Message
        </Button>
        {canCall ? (
          <>
            <IconButton
              icon={PhoneIcon}
              label="Voice call"
              variant="solid"
              disabled={!!busy}
              onClick={() => void call('audio')}
            />
            <IconButton
              icon={VideoIcon}
              label="Video call"
              variant="solid"
              disabled={!!busy}
              onClick={() => void call('video')}
            />
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        {onEditContact ? (
          <button type="button" className={LINK} onClick={() => onEditContact(user)}>
            {user.isContact ? (
              <>
                <Pencil size={14} aria-hidden /> Edit contact
              </>
            ) : (
              <>
                <UserPlus size={14} aria-hidden /> Add to contacts
              </>
            )}
          </button>
        ) : null}
        {user.isBlocked ? (
          <button type="button" className={LINK} onClick={() => void confirmUnblock(user)}>
            <Ban size={14} aria-hidden /> Unblock
          </button>
        ) : (
          <button
            type="button"
            className={cn(LINK, 'text-danger')}
            onClick={() => void confirmBlock(user)}
          >
            <Ban size={14} aria-hidden /> Block
          </button>
        )}
        <Link to={`/u/${user.username}`} onClick={onNavigate} className={cn(LINK, 'ml-auto')}>
          View full profile
        </Link>
      </div>
    </>
  );
}

function SelfActions({
  note,
  onNavigate,
  onSetStatus,
}: {
  note: PresenceNote | null;
  onNavigate?: () => void;
  onSetStatus?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <>
      <AvailabilityPicker />
      {onSetStatus ? (
        <button type="button" onClick={onSetStatus} className={ROW} data-testid="set-status">
          <Smile size={18} className="shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[14.5px] text-fg">
            {note ? formatPresenceNote(note) : 'Set a custom status'}
          </span>
          {note ? <span className="text-[12px] text-muted">Edit</span> : null}
        </button>
      ) : null}
      <Button
        variant="soft"
        leftIcon={Pencil}
        fullWidth
        onClick={() => {
          onNavigate?.();
          void navigate('/settings/profile');
        }}
      >
        Edit profile
      </Button>
    </>
  );
}
