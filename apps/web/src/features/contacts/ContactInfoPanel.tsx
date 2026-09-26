/**
 * Contact info for a direct chat (agent 1), shown by the conversation inside a <Sheet>.
 * Props are the cross-feature contract: `{ chatId, onClose }` (InfoPanelProps).
 *
 * Profile (photo viewer, name, username, phone, about, presence), quick actions (calls,
 * add/edit contact), shared media/docs/links (+ gallery), starred messages, mute,
 * disappearing messages, groups in common, block/unblock, clear chat, delete chat. The
 * "Message yourself" chat and deleted accounts get reduced variants.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  AtSign,
  Ban,
  BellOff,
  ChevronRight,
  Eraser,
  Image as ImageIcon,
  NotebookPen,
  Pencil,
  Phone,
  Star,
  Timer,
  Trash2,
  UserPlus,
  UserRoundX,
  UsersRound,
} from 'lucide-react';
import {
  DISAPPEARING_OPTIONS,
  MUTE_FOREVER_ISO,
  chatTitle,
  formatTimer,
  isMuted,
  userDisplayName,
  type ChatSummary,
  type ID,
  type Message,
  type UserPublic,
} from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { VideoIcon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Avatar,
  IconButton,
  Skeleton,
  Spinner,
  Switch,
  choose,
  confirm,
  toast,
  type IconType,
} from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatLastSeen, formatShortDate, formatTime } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChat, useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { usePresence, useUsers } from '@/stores/users';
import { StarredView } from '@/features/groups/shared/StarredView';
import {
  mediaTotal,
  useChatMediaCounts,
  useStarredCount,
} from '@/features/groups/shared/mediaCounts';
import {
  ChatMediaGallery,
  MediaLightbox,
  MediaThumb,
  fetchChatMedia,
  type MediaTab,
} from './ChatMediaGallery';
import { EditContactDialog } from './ContactDialogs';
import { confirmBlock, confirmUnblock, deleteContactFlow } from './contactActions';
import { PhotoViewer } from './PhotoViewer';

export interface InfoPanelProps {
  chatId: ID;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('border-t-8 border-app bg-surface py-1', className)}>{children}</section>
  );
}

function Row({
  icon: Icon,
  title,
  subtitle,
  onClick,
  end,
  danger,
  testId,
}: {
  icon: IconType;
  title: ReactNode;
  subtitle?: ReactNode;
  onClick?: () => void;
  end?: ReactNode;
  danger?: boolean;
  testId?: string;
}) {
  const body = (
    <>
      <Icon
        size={22}
        className={cn('shrink-0', danger ? 'text-danger' : 'text-muted')}
        aria-hidden
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('text-[15.5px]', danger ? 'text-danger' : 'text-fg')}>{title}</span>
        {subtitle ? <span className="text-[13px] text-muted">{subtitle}</span> : null}
      </span>
      {end}
    </>
  );
  const cls =
    'flex min-h-13 w-full items-center gap-5 px-5 py-3 text-left outline-none transition-colors';
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        cls,
        'hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
      )}
      data-testid={testId}
    >
      {body}
    </button>
  ) : (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: IconType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-24 flex-col items-center gap-1.5 rounded-2xl border border-line px-2 py-3 text-brand-ink outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
    >
      <Icon size={22} aria-hidden />
      <span className="text-[13px] font-medium text-fg">{label}</span>
    </button>
  );
}

function muteLabel(mutedUntil: string | null): string | undefined {
  if (!isMuted(mutedUntil)) return undefined;
  if (mutedUntil === MUTE_FOREVER_ISO || new Date(mutedUntil!).getFullYear() > 9000)
    return 'Muted always';
  const d = new Date(mutedUntil!);
  const sameDay = d.toDateString() === new Date().toDateString();
  return `Muted until ${sameDay ? formatTime(d) : `${formatShortDate(d)} ${formatTime(d)}`}`;
}

// ---------------------------------------------------------------------------
// Chat actions
// ---------------------------------------------------------------------------

async function setMute(chat: ChatSummary, on: boolean): Promise<void> {
  let mutedUntil: string | null = null;
  if (on) {
    const choice = await choose({
      title: 'Mute notifications',
      message: 'Other members won’t know you muted this chat.',
      options: [
        { value: '8h', label: '8 hours' },
        { value: '1w', label: '1 week' },
        { value: 'always', label: 'Always' },
      ],
    });
    if (!choice) return;
    const hour = 3_600_000;
    mutedUntil =
      choice === 'always'
        ? MUTE_FOREVER_ISO
        : new Date(Date.now() + (choice === '8h' ? 8 * hour : 7 * 24 * hour)).toISOString();
  }
  const prev = chat.mutedUntil;
  useChats.getState().patchChat(chat.id, { mutedUntil });
  try {
    const updated = await api.patch<ChatSummary>(`/api/chats/${chat.id}/prefs`, { mutedUntil });
    useChats.getState().upsertChat(updated);
  } catch (e) {
    useChats.getState().patchChat(chat.id, { mutedUntil: prev });
    toast.error(e);
  }
}

async function setDisappearing(chat: ChatSummary): Promise<void> {
  const choice = await choose({
    title: 'Disappearing messages',
    message:
      'New messages in this chat will disappear after the selected time. Anyone in the chat can change this.',
    options: [
      ...DISAPPEARING_OPTIONS.map((s) => ({ value: String(s), label: formatTimer(s) })),
      { value: 'off', label: 'Off' },
    ],
  });
  if (!choice) return;
  const seconds = choice === 'off' ? null : Number(choice);
  if (seconds === chat.disappearingSeconds) return;
  try {
    const updated = await api.put<ChatSummary>(`/api/chats/${chat.id}/disappearing`, { seconds });
    useChats.getState().upsertChat(updated);
    toast.success(
      seconds
        ? `Messages will disappear after ${formatTimer(seconds)}`
        : 'Disappearing messages turned off',
    );
  } catch (e) {
    toast.error(e);
  }
}

async function clearChat(chat: ChatSummary): Promise<void> {
  const ok = await confirm({
    title: 'Clear this chat?',
    message:
      'Messages will be removed for you only. Starred messages in this chat are removed too.',
    confirmLabel: 'Clear chat',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.post(`/api/chats/${chat.id}/clear`);
    useMessages.getState().clearChat(chat.id, chat.lastSeq);
    useChats.getState().patchChat(chat.id, {
      lastMessage: null,
      unreadCount: 0,
      unreadMentionCount: 0,
    });
    toast.success('Chat cleared');
  } catch (e) {
    toast.error(e);
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function ContactInfoPanel({ chatId, onClose }: InfoPanelProps) {
  const chat = useChat(chatId);
  const desktop = useIsDesktop();
  const [view, setView] = useState<{ gallery: MediaTab } | 'starred' | null>(null);
  if (!chat) {
    return (
      <div className="flex min-h-full flex-col bg-surface">
        <PaneHeader
          title="Contact info"
          back={onClose}
          backIcon={desktop ? 'close' : 'arrow'}
          border
        />
      </div>
    );
  }
  if (view === 'starred') return <StarredView chat={chat} onBack={() => setView(null)} />;
  if (view) {
    return (
      <div className="flex min-h-full flex-col bg-surface">
        <PaneHeader
          title={chatTitle(chat)}
          subtitle="Media, links and docs"
          back={() => setView(null)}
          border
        />
        <ChatMediaGallery chatId={chat.id} initialTab={view.gallery} />
      </div>
    );
  }
  return (
    <ContactInfo
      chat={chat}
      onClose={onClose}
      desktop={desktop}
      openGallery={(tab) => setView({ gallery: tab })}
      openStarred={() => setView('starred')}
    />
  );
}

function ContactInfo({
  chat,
  onClose,
  desktop,
  openGallery,
  openStarred,
}: {
  chat: ChatSummary;
  onClose: () => void;
  desktop: boolean;
  openGallery: (tab: MediaTab) => void;
  openStarred: () => void;
}) {
  const navigate = useNavigate();
  const me = useMe();
  const peerId = chat.peer?.id ?? null;
  const self = !!me && peerId === me.id;
  const cached = useUsers((s) => (peerId && !self ? s.byId[peerId] : undefined));
  const user: UserPublic | null = useMemo(
    () => (chat.peer ? { ...chat.peer, ...cached } : null),
    [chat.peer, cached],
  );
  const deleted = !!user?.isDeleted;
  const presence = usePresence(!self && !deleted ? peerId : null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [editing, setEditing] = useState<UserPublic | null>(null);
  const [media, setMedia] = useState<Message[] | null>(null);
  const counts = useChatMediaCounts(chat.id);
  const [lightbox, setLightbox] = useState<Message | null>(null);
  const [common, setCommon] = useState<ChatSummary[] | null>(null);
  const starred = useStarredCount(chat.id);
  const [deleting, setDeleting] = useState(false);

  // Fresh profile (about/phone/presence may have changed since the chat list loaded).
  useEffect(() => {
    if (!peerId || self) return;
    void useUsers
      .getState()
      .fetchUsers([peerId], { force: true })
      .catch(() => undefined);
  }, [peerId, self]);

  // Media strip (the latest photos & videos); totals come from /media/counts.
  useEffect(() => {
    let alive = true;
    fetchChatMedia(chat.id, 'media', undefined, 4)
      .catch(() => [] as Message[])
      .then((items) => alive && setMedia(items));
    return () => {
      alive = false;
    };
  }, [chat.id]);

  // Groups in common.
  useEffect(() => {
    if (!peerId || self || deleted) return;
    let alive = true;
    api
      .get<ChatSummary[]>(`/api/users/${peerId}/common-groups`)
      .then((list) => alive && setCommon(list))
      .catch(() => alive && setCommon([]));
    return () => {
      alive = false;
    };
  }, [peerId, self, deleted]);

  const name = self ? `${me?.displayName ?? 'You'} (You)` : userDisplayName(user);
  const avatarSrc = self ? me?.avatarUrl : user?.avatarUrl;
  const lastSeen = self || deleted ? '' : formatLastSeen(presence);
  const total = counts ? mediaTotal(counts) : null;

  const deleteChat = async () => {
    const ok = await confirm({
      title: `Delete chat with ${self ? 'yourself' : name}?`,
      message:
        'Messages will be deleted from this device and your other devices. This can’t be undone.',
      confirmLabel: 'Delete chat',
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.delete(`/api/chats/${chat.id}`);
      onClose();
      void navigate('/chats', { replace: true });
      useChats.getState().removeChat(chat.id);
      useMessages.getState().dropChat(chat.id);
      toast.success('Chat deleted');
    } catch (e) {
      toast.error(e);
      setDeleting(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col bg-app" data-testid="contact-info">
      <PaneHeader
        title={self ? 'Message yourself' : 'Contact info'}
        back={onClose}
        backIcon={desktop ? 'close' : 'arrow'}
        border
        actions={
          user && !self && !deleted ? (
            <IconButton
              icon={user.isContact ? Pencil : UserPlus}
              label={user.isContact ? 'Edit contact' : 'Add to contacts'}
              onClick={() => setEditing(user)}
            />
          ) : undefined
        }
      />

      {/* Hero */}
      <section className="flex flex-col items-center bg-surface px-6 pt-7 pb-5 text-center">
        <button
          type="button"
          onClick={() => avatarSrc && setPhotoOpen(true)}
          disabled={!avatarSrc}
          className="rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand disabled:cursor-default"
          aria-label={avatarSrc ? `View ${name}'s photo` : undefined}
        >
          {self && me ? (
            <Avatar src={me.avatarUrl} name={me.displayName} colorSeed={me.id} size="3xl" />
          ) : (
            <ChatAvatar chat={chat} size="3xl" />
          )}
        </button>
        <h2
          className="mt-4 text-[24px] leading-tight font-semibold break-words text-fg"
          data-testid="contact-name"
        >
          {name}
        </h2>
        {!self && user && !deleted ? (
          <>
            {user.contactName && user.contactName !== user.displayName ? (
              <p className="mt-0.5 text-[14px] text-muted">~{user.displayName}</p>
            ) : null}
            <p className="mt-1 text-[15px] text-muted">{user.phone ?? `@${user.username}`}</p>
          </>
        ) : null}
        {self ? <p className="mt-1 text-[15px] text-muted">Message yourself</p> : null}
        {lastSeen ? (
          <p className="mt-1 text-[13.5px] text-subtle" data-testid="contact-presence">
            {lastSeen}
          </p>
        ) : null}

        {!self && !deleted && user ? (
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {chat.permissions.canCall ? (
              <>
                <QuickAction
                  icon={Phone}
                  label="Voice"
                  onClick={() => void useCalls.getState().startCall(chat.id, 'audio')}
                />
                <QuickAction
                  icon={VideoIcon}
                  label="Video"
                  onClick={() => void useCalls.getState().startCall(chat.id, 'video')}
                />
              </>
            ) : null}
            <QuickAction
              icon={user.isContact ? Pencil : UserPlus}
              label={user.isContact ? 'Edit' : 'Add'}
              onClick={() => setEditing(user)}
            />
          </div>
        ) : null}
      </section>

      {/* About / identity */}
      {self ? (
        <Card>
          <div className="flex items-start gap-5 px-5 py-3">
            <NotebookPen size={22} className="mt-0.5 shrink-0 text-muted" aria-hidden />
            <p className="text-[14px] leading-relaxed text-muted">
              Use this chat to keep notes, links, photos and files for yourself. Only you can see
              it, and it syncs across your devices.
            </p>
          </div>
        </Card>
      ) : deleted ? (
        <Card>
          <Row
            icon={UserRoundX}
            title="This account was deleted"
            subtitle="You can’t message or call it anymore."
          />
        </Card>
      ) : user ? (
        <Card>
          {user.about ? (
            <div className="px-5 py-3">
              <p className="text-[13px] text-muted">About</p>
              <p className="mt-0.5 text-[15.5px] break-words text-fg" data-testid="contact-about">
                {user.about}
              </p>
            </div>
          ) : null}
          <Row icon={AtSign} title={`@${user.username}`} subtitle="Username" />
        </Card>
      ) : null}

      {/* Media */}
      <Card>
        <Row
          icon={ImageIcon}
          title="Media, links and docs"
          onClick={() => openGallery('media')}
          end={
            <span className="flex items-center gap-1 text-[14px] text-muted">
              {total === null ? <Spinner size={14} label={null} /> : String(total)}
              <ChevronRight size={18} className="text-subtle" aria-hidden />
            </span>
          }
          testId="media-row"
        />
        {media && media.length ? (
          <div className="grid grid-cols-4 gap-1.5 px-4 pb-3">
            {media.slice(0, 4).map((m) => (
              <MediaThumb key={m.id} m={m} onOpen={setLightbox} />
            ))}
          </div>
        ) : media === null ? (
          <div className="grid grid-cols-4 gap-1.5 px-4 pb-3" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : null}
        <Row
          icon={Star}
          title="Starred messages"
          onClick={openStarred}
          end={
            <span className="flex items-center gap-1 text-[14px] text-muted">
              {starred || ''}
              <ChevronRight size={18} className="text-subtle" aria-hidden />
            </span>
          }
        />
      </Card>

      {/* Chat settings */}
      <Card>
        <Row
          icon={BellOff}
          title="Mute notifications"
          subtitle={muteLabel(chat.mutedUntil)}
          end={
            <Switch
              aria-label="Mute notifications"
              checked={isMuted(chat.mutedUntil)}
              onChange={(v) => void setMute(chat, v)}
            />
          }
        />
        <Row
          icon={Timer}
          title="Disappearing messages"
          subtitle={chat.disappearingSeconds ? formatTimer(chat.disappearingSeconds) : 'Off'}
          onClick={chat.permissions.canEditInfo ? () => void setDisappearing(chat) : undefined}
          end={
            chat.permissions.canEditInfo ? (
              <ChevronRight size={18} className="text-subtle" aria-hidden />
            ) : undefined
          }
        />
      </Card>

      {/* Groups in common */}
      {!self && !deleted ? (
        <Card>
          <p className="px-5 pt-3 pb-1 text-[13.5px] text-muted">
            {common === null
              ? 'Groups in common'
              : common.length
                ? `${common.length} group${common.length === 1 ? '' : 's'} in common`
                : 'No groups in common'}
          </p>
          {common === null ? (
            <div className="flex items-center gap-4 px-5 py-2.5">
              <Skeleton circle className="size-10" />
              <Skeleton className="h-3.5 w-40" />
            </div>
          ) : (
            <ul>
              {common.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      void navigate(`/chats/${g.id}`);
                    }}
                    className="flex w-full items-center gap-4 px-5 py-2.5 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                  >
                    <ChatAvatar chat={g} size="md" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15.5px] text-fg">{chatTitle(g)}</span>
                      <span className="truncate text-[13px] text-muted">
                        {g.memberCount} members
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {common.length === 0 ? (
                <li className="flex items-center gap-4 px-5 pt-1 pb-3 text-[13.5px] text-subtle">
                  <UsersRound size={18} aria-hidden /> Groups you share will show up here.
                </li>
              ) : null}
            </ul>
          )}
        </Card>
      ) : null}

      {/* Danger zone */}
      <Card className="pb-[max(8px,env(safe-area-inset-bottom))]">
        {user && !self && !deleted ? (
          <>
            {user.isContact ? (
              <Row
                icon={Trash2}
                title="Delete contact"
                danger
                onClick={() => void deleteContactFlow(user)}
              />
            ) : (
              <Row icon={UserPlus} title="Add to contacts" onClick={() => setEditing(user)} />
            )}
            {user.isBlocked ? (
              <Row
                icon={Ban}
                title={`Unblock ${userDisplayName(user)}`}
                onClick={() => void confirmUnblock(user)}
                testId="unblock-contact"
              />
            ) : (
              <Row
                icon={Ban}
                title={`Block ${userDisplayName(user)}`}
                danger
                onClick={() => void confirmBlock(user)}
                testId="block-contact"
              />
            )}
          </>
        ) : null}
        <Row icon={Eraser} title="Clear chat" danger onClick={() => void clearChat(chat)} />
        <Row
          icon={Trash2}
          title="Delete chat"
          danger
          onClick={deleting ? undefined : () => void deleteChat()}
          end={deleting ? <Spinner size={16} label={null} /> : undefined}
        />
        {chat.createdAt ? (
          <p className="px-5 pt-2 pb-3 text-[12.5px] text-subtle">
            Chat started {formatShortDate(chat.createdAt)}
          </p>
        ) : null}
      </Card>

      <PhotoViewer
        open={photoOpen}
        onClose={() => setPhotoOpen(false)}
        src={avatarSrc}
        title={name}
        subtitle={self ? 'Profile photo' : user ? `@${user.username}` : undefined}
      />
      <MediaLightbox m={lightbox} onClose={() => setLightbox(null)} />
      <EditContactDialog user={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
