/**
 * Contact info for a direct chat (web features/contacts/ContactInfoPanel.tsx), shown by the
 * conversation inside a <Sheet>; props `{ chatId, onClose }`.
 *
 * Profile (photo viewer, name, username, phone, about, presence), quick actions (calls,
 * add/edit contact), shared media/docs/links (+ gallery), starred messages, mute,
 * disappearing messages, groups in common, block/unblock, clear chat, delete chat. The
 * "Message yourself" chat and deleted accounts get reduced variants.
 */
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AtSign,
  Ban,
  BellOff,
  CalendarDays,
  ChevronRight,
  Eraser,
  Image as ImageIcon,
  NotebookPen,
  Palette,
  Pencil,
  Star,
  Timer,
  Trash2,
  UserPlus,
  UserRoundX,
  UsersRound,
} from 'lucide-react-native';
import {
  DISAPPEARING_OPTIONS,
  MUTE_FOREVER_ISO,
  chatTitle,
  formatTimer,
  isMuted,
  userDisplayName,
} from '@enbox/shared';
import { ChatAvatar, UserAvatar } from '@/components/common/avatars';
import { Icon, PhoneIcon, VideoIcon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Avatar,
  IconButton,
  Press,
  SectionLabel,
  Skeleton,
  Spinner,
  Switch,
  T,
  choose,
  confirm,
  toast,
} from '@/components/ui';
import { ChatThemeSheet } from '@/features/appearance/ChatThemeSheet';
import { chatThemeLabel } from '@/features/appearance/presets';
import {
  mediaTotal,
  useChatMediaCounts,
  useStarredCount,
} from '@/features/groups/shared/mediaCounts';
import { StarredView } from '@/features/groups/shared/StarredView';
import { ProfileBanner } from '@/features/profile/ProfileCard';
import { api } from '@/lib/api';
import { formatLastSeen, formatMonthYear, formatShortDate, formatTime } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChat, useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { usePresence, useUsers } from '@/stores/users';
import { useTheme } from '@/theme';
import { ChatMediaGallery, MediaLightbox, MediaThumb, fetchChatMedia } from './ChatMediaGallery';
import { EditContactDialog } from './ContactDialogs';
import { confirmBlock, confirmUnblock, deleteContactFlow } from './contactActions';
import { PhotoViewer } from './PhotoViewer';

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Card({ children, style }) {
  const { tw } = useTheme();
  return (
    <View style={[tw`mx-3 mt-3 overflow-hidden rounded-xl bg-surface-2 py-1`, style]}>
      {children}
    </View>
  );
}

function Row({ icon, title, subtitle, onPress, end, danger }) {
  const { tw, c } = useTheme();
  const body = (
    <>
      <Icon icon={icon} size={22} color={danger ? c.danger : c.muted} />
      <View style={tw`min-w-0 flex-1`}>
        <T style={[tw`text-[15.5px]`, danger ? tw`text-danger` : null]}>{title}</T>
        {subtitle ? <T style={tw`text-[13px] text-muted`}>{subtitle}</T> : null}
      </View>
      {end}
    </>
  );
  const style = tw`min-h-13 w-full flex-row items-center gap-5 px-5 py-3`;
  return onPress ? (
    <Press onPress={onPress} accessibilityRole="button" style={style}>
      {body}
    </Press>
  ) : (
    <View style={style}>{body}</View>
  );
}

function QuickAction({ icon, label, onPress }) {
  const { tw, c } = useTheme();
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={label}
      style={tw`w-24 items-center gap-1.5 rounded-2xl bg-surface-2 px-2 py-3`}
    >
      <Icon icon={icon} size={22} color={c['brand-ink']} />
      <T style={tw`text-[13px] font-medium`}>{label}</T>
    </Press>
  );
}

function Chevron() {
  const { c } = useTheme();
  return <Icon icon={ChevronRight} size={18} color={c.subtle} />;
}

function muteLabel(mutedUntil) {
  if (!isMuted(mutedUntil)) return undefined;
  if (mutedUntil === MUTE_FOREVER_ISO || new Date(mutedUntil).getFullYear() > 9000)
    return 'Muted always';
  const d = new Date(mutedUntil);
  const sameDay = d.toDateString() === new Date().toDateString();
  return `Muted until ${sameDay ? formatTime(d) : `${formatShortDate(d)} ${formatTime(d)}`}`;
}

// ---------------------------------------------------------------------------
// Chat actions
// ---------------------------------------------------------------------------

async function setMute(chat, on) {
  let mutedUntil = null;
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
    const updated = await api.patch(`/api/chats/${chat.id}/prefs`, { mutedUntil });
    useChats.getState().upsertChat(updated);
  } catch (e) {
    useChats.getState().patchChat(chat.id, { mutedUntil: prev });
    toast.error(e);
  }
}

async function setDisappearing(chat) {
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
    const updated = await api.put(`/api/chats/${chat.id}/disappearing`, { seconds });
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

async function clearChat(chat) {
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

export function ContactInfoPanel({ chatId, onClose }) {
  const { tw } = useTheme();
  const chat = useChat(chatId);
  const [view, setView] = useState(null);
  if (!chat)
    return (
      <View style={tw`flex-1 bg-surface`}>
        <PaneHeader title="Contact info" back={onClose} />
      </View>
    );
  if (view === 'starred') return <StarredView chat={chat} onBack={() => setView(null)} />;
  if (view)
    return (
      <View style={tw`flex-1 bg-surface`}>
        <PaneHeader
          title={chatTitle(chat)}
          subtitle="Media, links and docs"
          back={() => setView(null)}
        />
        <ChatMediaGallery chatId={chat.id} initialTab={view.gallery} />
      </View>
    );
  return (
    <ContactInfo
      chat={chat}
      onClose={onClose}
      openGallery={(tab) => setView({ gallery: tab })}
      openStarred={() => setView('starred')}
    />
  );
}

function ContactInfo({ chat, onClose, openGallery, openStarred }) {
  const { tw, c } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const me = useMe();
  const peerId = chat.peer?.id ?? null;
  const self = !!me && peerId === me.id;
  const cached = useUsers((s) => (peerId && !self ? s.byId[peerId] : undefined));
  const user = useMemo(() => (chat.peer ? { ...chat.peer, ...cached } : null), [chat.peer, cached]);
  const deleted = !!user?.isDeleted;
  const presence = usePresence(!self && !deleted ? peerId : null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [media, setMedia] = useState(null);
  const counts = useChatMediaCounts(chat.id);
  const [lightbox, setLightbox] = useState(null);
  const [common, setCommon] = useState(null);
  const starred = useStarredCount(chat.id);
  const [deleting, setDeleting] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const showBanner =
    !self && !deleted && !!user && !!(user.bannerUrl || user.profileColor || user.accentColor);

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
      .catch(() => [])
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
      .get(`/api/users/${peerId}/common-groups`)
      .then((list) => alive && setCommon(list))
      .catch(() => alive && setCommon([]));
    return () => {
      alive = false;
    };
  }, [peerId, self, deleted]);

  const name = self ? `${me?.displayName ?? 'You'} (You)` : userDisplayName(user);
  const avatarSrc = self ? me?.avatarUrl : user?.avatarUrl;
  const avatarAnimated = self ? me?.avatarAnimatedUrl : user?.avatarAnimatedUrl;
  const lastSeen = self || deleted ? '' : formatLastSeen(presence);
  const total = counts ? mediaTotal(counts) : null;
  const thumb = Math.floor((Math.min(width, 640) - 24 - 32 - 18) / 4);

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
      router.replace('/chats');
      useChats.getState().removeChat(chat.id);
      useMessages.getState().dropChat(chat.id);
      toast.success('Chat deleted');
    } catch (e) {
      toast.error(e);
      setDeleting(false);
    }
  };

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title={self ? 'Message yourself' : 'Contact info'}
        back={onClose}
        actions={
          user && !self && !deleted ? (
            <IconButton
              icon={user.isContact ? Pencil : UserPlus}
              label={user.isContact ? 'Edit contact' : 'Add to contacts'}
              onPress={() => setEditing(user)}
            />
          ) : undefined
        }
      />
      <ScrollView style={tw`min-h-0 flex-1`} contentContainerStyle={tw`pb-4`}>
        {/* Hero: the banner (or profile colours) with the avatar overlapping it. */}
        <View style={tw`items-center bg-surface pb-5`}>
          {showBanner ? <ProfileBanner user={user} /> : null}
          <Press
            onPress={() => avatarSrc && setPhotoOpen(true)}
            disabled={!avatarSrc}
            accessibilityLabel={avatarSrc ? `View ${name}'s photo` : undefined}
            style={[
              tw`rounded-full`,
              showBanner ? [tw`bg-surface p-1`, { marginTop: -76 }] : tw`mt-7`,
            ]}
          >
            {self && me ? (
              <Avatar
                src={me.avatarUrl}
                animatedSrc={me.avatarAnimatedUrl}
                name={me.displayName}
                colorSeed={me.id}
                size="3xl"
              />
            ) : user && !deleted ? (
              <UserAvatar user={user} size="3xl" showPresence />
            ) : (
              <ChatAvatar chat={chat} size="3xl" />
            )}
          </Press>
          <T style={tw`mt-4 px-6 text-center text-[24px] leading-tight font-semibold`}>{name}</T>
          {!self && user && !deleted ? (
            <>
              {user.contactName && user.contactName !== user.displayName ? (
                <T style={tw`mt-0.5 px-6 text-center text-[14px] text-muted`}>
                  ~{user.displayName}
                </T>
              ) : null}
              <T style={tw`mt-1 px-6 text-center text-[15px] text-muted`}>
                {user.phone ?? `@${user.username}`}
                {user.pronouns ? ` · ${user.pronouns}` : ''}
              </T>
            </>
          ) : null}
          {self ? <T style={tw`mt-1 text-[15px] text-muted`}>Message yourself</T> : null}
          {lastSeen ? (
            <T style={tw`mt-1 text-center text-[13.5px] text-subtle`}>{lastSeen}</T>
          ) : null}

          {!self && !deleted && user ? (
            <View style={tw`mt-5 flex-row flex-wrap justify-center gap-3 px-6`}>
              {chat.permissions.canCall ? (
                <>
                  <QuickAction
                    icon={PhoneIcon}
                    label="Voice"
                    onPress={() => void useCalls.getState().startCall(chat.id, 'audio')}
                  />
                  <QuickAction
                    icon={VideoIcon}
                    label="Video"
                    onPress={() => void useCalls.getState().startCall(chat.id, 'video')}
                  />
                </>
              ) : null}
              <QuickAction
                icon={user.isContact ? Pencil : UserPlus}
                label={user.isContact ? 'Edit' : 'Add'}
                onPress={() => setEditing(user)}
              />
            </View>
          ) : null}
        </View>

        {/* About / identity */}
        {self ? (
          <Card>
            <View style={tw`flex-row items-start gap-5 px-5 py-3`}>
              <Icon icon={NotebookPen} size={22} color={c.muted} style={tw`mt-0.5`} />
              <T style={[tw`min-w-0 flex-1 text-[14px] text-muted`, { lineHeight: 22.75 }]}>
                Use this chat to keep notes, links, photos and files for yourself. Only you can
                see it, and it syncs across your devices.
              </T>
            </View>
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
            {user.bio ? (
              <View style={tw`px-5 py-3`}>
                <SectionLabel style={tw`mb-1`}>About me</SectionLabel>
                <T style={[tw`mt-0.5 text-[15.5px]`, { lineHeight: 25 }]}>{user.bio}</T>
              </View>
            ) : null}
            {user.about ? (
              <View style={tw`px-5 py-3`}>
                <SectionLabel style={tw`mb-1`}>About</SectionLabel>
                <T style={tw`mt-0.5 text-[15.5px]`}>{user.about}</T>
              </View>
            ) : null}
            <Row icon={AtSign} title={`@${user.username}`} subtitle="Username" />
            {user.createdAt ? (
              <Row
                icon={CalendarDays}
                title={formatMonthYear(user.createdAt)}
                subtitle="Member since"
              />
            ) : null}
          </Card>
        ) : null}

        {/* Media */}
        <Card>
          <Row
            icon={ImageIcon}
            title="Media, links and docs"
            onPress={() => openGallery('media')}
            end={
              <View style={tw`flex-row items-center gap-1`}>
                {total === null ? (
                  <Spinner size={14} />
                ) : (
                  <T style={tw`text-[14px] text-muted`}>{String(total)}</T>
                )}
                <Chevron />
              </View>
            }
          />
          {media && media.length ? (
            <View style={tw`flex-row gap-1.5 px-4 pb-3`}>
              {media.slice(0, 4).map((m) => (
                <MediaThumb key={m.id} m={m} size={thumb} onOpen={setLightbox} />
              ))}
            </View>
          ) : media === null ? (
            <View style={tw`flex-row gap-1.5 px-4 pb-3`}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} style={[tw`rounded-lg`, { width: thumb, height: thumb }]} />
              ))}
            </View>
          ) : null}
          <Row
            icon={Star}
            title="Starred messages"
            onPress={openStarred}
            end={
              <View style={tw`flex-row items-center gap-1`}>
                {starred ? <T style={tw`text-[14px] text-muted`}>{starred}</T> : null}
                <Chevron />
              </View>
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
                accessibilityLabel="Mute notifications"
                checked={isMuted(chat.mutedUntil)}
                onChange={(v) => void setMute(chat, v)}
              />
            }
          />
          <Row
            icon={Timer}
            title="Disappearing messages"
            subtitle={chat.disappearingSeconds ? formatTimer(chat.disappearingSeconds) : 'Off'}
            onPress={chat.permissions.canEditInfo ? () => void setDisappearing(chat) : undefined}
            end={chat.permissions.canEditInfo ? <Chevron /> : undefined}
          />
          <Row
            icon={Palette}
            title="Chat theme"
            subtitle={chatThemeLabel(chat)}
            onPress={() => setThemeOpen(true)}
            end={<Chevron />}
          />
        </Card>

        {/* Groups in common */}
        {!self && !deleted ? (
          <Card>
            <T style={tw`px-5 pt-3 pb-1 text-[13.5px] text-muted`}>
              {common === null
                ? 'Groups in common'
                : common.length
                  ? `${common.length} group${common.length === 1 ? '' : 's'} in common`
                  : 'No groups in common'}
            </T>
            {common === null ? (
              <View style={tw`flex-row items-center gap-4 px-5 py-2.5`}>
                <Skeleton circle style={tw`size-10`} />
                <Skeleton style={tw`h-3.5 w-40`} />
              </View>
            ) : (
              <>
                {common.map((g) => (
                  <Press
                    key={g.id}
                    onPress={() => {
                      onClose();
                      router.push(`/chats/${g.id}`);
                    }}
                    style={tw`flex-row items-center gap-4 px-5 py-2.5`}
                  >
                    <ChatAvatar chat={g} size="md" />
                    <View style={tw`min-w-0 flex-1`}>
                      <T numberOfLines={1} style={tw`text-[15.5px]`}>
                        {chatTitle(g)}
                      </T>
                      <T numberOfLines={1} style={tw`text-[13px] text-muted`}>
                        {g.memberCount} members
                      </T>
                    </View>
                  </Press>
                ))}
                {common.length === 0 ? (
                  <View style={tw`flex-row items-center gap-4 px-5 pt-1 pb-3`}>
                    <Icon icon={UsersRound} size={18} color={c.subtle} />
                    <T style={tw`text-[13.5px] text-subtle`}>Groups you share will show up here.</T>
                  </View>
                ) : null}
              </>
            )}
          </Card>
        ) : null}

        {/* Danger zone */}
        <Card style={{ paddingBottom: Math.max(8, insets.bottom) }}>
          {user && !self && !deleted ? (
            <>
              {user.isContact ? (
                <Row
                  icon={Trash2}
                  title="Delete contact"
                  danger
                  onPress={() => void deleteContactFlow(user)}
                />
              ) : (
                <Row icon={UserPlus} title="Add to contacts" onPress={() => setEditing(user)} />
              )}
              {user.isBlocked ? (
                <Row
                  icon={Ban}
                  title={`Unblock ${userDisplayName(user)}`}
                  onPress={() => void confirmUnblock(user)}
                />
              ) : (
                <Row
                  icon={Ban}
                  title={`Block ${userDisplayName(user)}`}
                  danger
                  onPress={() => void confirmBlock(user)}
                />
              )}
            </>
          ) : null}
          <Row icon={Eraser} title="Clear chat" danger onPress={() => void clearChat(chat)} />
          <Row
            icon={Trash2}
            title="Delete chat"
            danger
            onPress={deleting ? undefined : () => void deleteChat()}
            end={deleting ? <Spinner size={16} /> : undefined}
          />
          {chat.createdAt ? (
            <T style={tw`px-5 pt-2 pb-3 text-[12.5px] text-subtle`}>
              Chat started {formatShortDate(chat.createdAt)}
            </T>
          ) : null}
        </Card>
      </ScrollView>

      <PhotoViewer
        open={photoOpen}
        onClose={() => setPhotoOpen(false)}
        src={avatarSrc}
        animatedSrc={avatarAnimated}
        title={name}
        subtitle={self ? 'Profile photo' : user ? `@${user.username}` : undefined}
      />
      <MediaLightbox m={lightbox} onClose={() => setLightbox(null)} />
      <EditContactDialog user={editing} onClose={() => setEditing(null)} />
      {themeOpen ? <ChatThemeSheet chat={chat} onClose={() => setThemeOpen(false)} /> : null}
    </View>
  );
}
