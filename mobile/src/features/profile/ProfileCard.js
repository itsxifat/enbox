/**
 * Discord-style profile card (web features/profile/ProfileCard.tsx): banner (or the
 * profile-colour gradient), avatar with the presence badge, name / saved name,
 * @username · pronouns, the custom status, "About me" (bio), about, member since, groups in
 * common and the actions — Message / Voice / Video / Add contact / Block / View full profile
 * for others; availability, custom status and Edit profile on my own card. `preview` (the
 * Settings → Profile preview) has no actions.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ban, MessageCircle, Pencil, Smile, UserPlus, UserRoundX } from 'lucide-react-native';
import { activePresenceNote, chatTitle, userDisplayName } from '@enbox/shared';
import { ChatAvatar, presenceBadge } from '@/components/common/avatars';
import { Icon, PhoneIcon, VideoIcon } from '@/components/icons';
import {
  Avatar,
  Button,
  Gradient,
  IconButton,
  Press,
  SectionLabel,
  Skeleton,
  T,
  toast,
} from '@/components/ui';
import { confirmBlock, confirmUnblock, openDirectChat } from '@/features/contacts/contactActions';
import { mediaUrl } from '@/lib/api';
import { formatMonthYear, formatPresenceNote, presenceLabel } from '@/lib/format';
import { useCalls } from '@/stores/calls';
import { useChats } from '@/stores/chats';
import { useUi } from '@/stores/ui';
import { mix, useTheme } from '@/theme';
import { AvailabilityPicker } from './AvailabilityPicker';

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Header colours without a banner: profile colour → accent colour (or a darker profile colour). */
export function useProfileGradient(profileColor, accentColor) {
  const { c } = useTheme();
  const from = profileColor ?? c.brand;
  const to = accentColor ?? mix(from, 72, '#000000');
  return { from, to };
}

/** The banner (animated original when allowed) or the gradient, at 5:2. */
export function ProfileBanner({ user, style, children }) {
  const autoplay = useUi((s) => s.prefs.autoplayAnimatedMedia);
  const reduce = useUi((s) => s.prefs.reduceMotion === 'on');
  const { from, to } = useProfileGradient(user.profileColor, user.accentColor);
  const play = !!user.bannerAnimatedUrl && !reduce && autoplay !== 'never';
  const banner = mediaUrl(play ? user.bannerAnimatedUrl : user.bannerUrl);
  return (
    <Gradient
      from={from}
      to={to}
      style={[
        { width: '100%', aspectRatio: 5 / 2 },
        user.accentColor ? { borderBottomWidth: 3, borderBottomColor: user.accentColor } : null,
        style,
      ]}
    >
      {banner ? (
        <Image
          source={{ uri: banner }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          autoplay={play}
        />
      ) : null}
      {children}
    </Gradient>
  );
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
  style,
}) {
  const { tw } = useTheme();
  const deleted = user.isDeleted;
  const state = deleted ? null : presence ? presenceBadge(presence) : user.presenceState;
  const note = deleted ? null : activePresenceNote(presence ? presence.note : user.presenceNote);
  const name = userDisplayName(user);
  const alias =
    !deleted && user.contactName && user.contactName !== user.displayName ? user.displayName : null;

  return (
    <View style={[tw`overflow-hidden bg-elevated`, style]}>
      <ProfileBanner user={user} />
      <View style={tw`px-4`}>
        <View style={[tw`self-start rounded-full`, { marginTop: -40 }]}>
          <Avatar
            src={deleted ? null : user.avatarUrl}
            animatedSrc={deleted ? null : user.avatarAnimatedUrl}
            animate="always"
            name={name}
            colorSeed={user.id}
            size={80}
            presence={state}
          />
        </View>
      </View>
      <View style={tw`gap-2.5 px-4 pt-2 pb-3`}>
        <View style={tw`min-w-0 rounded-xl bg-surface-2 px-3 py-2.5`}>
          <T numberOfLines={1} style={tw`text-[19px] font-semibold leading-tight`}>
            {name}
          </T>
          {alias ? (
            <T numberOfLines={1} style={tw`text-[13.5px] text-muted`}>
              ~{alias}
            </T>
          ) : null}
          {!deleted ? (
            <T numberOfLines={1} style={tw`text-[13.5px] text-muted`}>
              @{user.username}
              {user.pronouns ? ` · ${user.pronouns}` : ''}
            </T>
          ) : null}
          {state && state !== 'offline' ? (
            <T style={tw`mt-1 text-[12.5px] text-subtle`}>{capitalize(presenceLabel(state))}</T>
          ) : null}
          {note ? (
            <View style={tw`mt-2 self-start rounded-lg bg-elevated px-2.5 py-1.5`}>
              <T style={tw`text-[13.5px]`}>{formatPresenceNote(note)}</T>
            </View>
          ) : null}
        </View>

        {user.bio ? (
          <View>
            <SectionLabel style={tw`mb-1`}>About me</SectionLabel>
            <T style={[tw`text-[14px]`, { lineHeight: 22.75 }]}>{user.bio}</T>
          </View>
        ) : null}
        {user.about ? (
          <View>
            <SectionLabel style={tw`mb-1`}>About</SectionLabel>
            <T style={tw`text-[14px]`}>{user.about}</T>
          </View>
        ) : null}
        {user.createdAt ? (
          <View>
            <SectionLabel style={tw`mb-1`}>Member since</SectionLabel>
            <T style={tw`text-[14px]`}>{formatMonthYear(user.createdAt)}</T>
          </View>
        ) : null}
        {commonGroups !== undefined && !self && !deleted ? (
          <CommonGroups groups={commonGroups} onNavigate={onNavigate} />
        ) : null}

        {preview ? null : deleted ? (
          <DeletedNote />
        ) : self ? (
          <SelfActions note={note} onNavigate={onNavigate} onSetStatus={onSetStatus} />
        ) : (
          <UserActions user={user} onNavigate={onNavigate} onEditContact={onEditContact} />
        )}
      </View>
    </View>
  );
}

function DeletedNote() {
  const { tw, c } = useTheme();
  return (
    <View style={tw`flex-row items-center gap-2`}>
      <Icon icon={UserRoundX} size={16} color={c.muted} />
      <T style={tw`text-[13px] text-muted`}>This account was deleted.</T>
    </View>
  );
}

function CommonGroups({ groups, onNavigate }) {
  const { tw } = useTheme();
  const router = useRouter();
  if (groups === null) return <Skeleton style={tw`h-4 w-36`} />;
  if (!groups.length) return null;
  const shown = groups.slice(0, 3);
  return (
    <View>
      <SectionLabel style={tw`mb-1`}>
        {groups.length === 1 ? '1 group in common' : `${groups.length} groups in common`}
      </SectionLabel>
      <View style={tw`-mx-1`}>
        {shown.map((g) => (
          <Press
            key={g.id}
            onPress={() => {
              onNavigate?.();
              router.push(`/chats/${g.id}`);
            }}
            style={tw`flex-row items-center gap-2.5 rounded-lg px-1 py-1`}
          >
            <ChatAvatar chat={g} size="xs" />
            <T numberOfLines={1} style={tw`min-w-0 flex-1 text-[13.5px]`}>
              {chatTitle(g)}
            </T>
          </Press>
        ))}
        {groups.length > shown.length ? (
          <T style={tw`px-1 pt-0.5 text-[12.5px] text-muted`}>
            and {groups.length - shown.length} more
          </T>
        ) : null}
      </View>
    </View>
  );
}

function LinkButton({ icon, label, onPress, danger, style }) {
  const { tw, c } = useTheme();
  const color = danger ? c.danger : c['brand-ink'];
  return (
    <Press
      onPress={onPress}
      feedback={false}
      style={[tw`flex-row items-center gap-1 rounded py-1`, style]}
    >
      {icon ? <Icon icon={icon} size={14} color={color} /> : null}
      <T style={[tw`text-[13px]`, { color }]}>{label}</T>
    </Press>
  );
}

function UserActions({ user, onNavigate, onEditContact }) {
  const { tw } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const directChat = useChats((s) =>
    Object.values(s.byId).find((c) => c.type === 'direct' && c.peer?.id === user.id),
  );
  const canCall = directChat ? directChat.permissions.canCall : !user.isBlocked;

  const message = async () => {
    setBusy('message');
    try {
      const chat = await openDirectChat(user.id);
      onNavigate?.();
      router.push(`/chats/${chat.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const call = async (type) => {
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
      <View style={tw`flex-row items-center gap-2`}>
        <Button
          leftIcon={MessageCircle}
          fullWidth
          style={tw`flex-1`}
          loading={busy === 'message'}
          disabled={!!busy}
          onPress={() => void message()}
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
              onPress={() => void call('audio')}
            />
            <IconButton
              icon={VideoIcon}
              label="Video call"
              variant="solid"
              disabled={!!busy}
              onPress={() => void call('video')}
            />
          </>
        ) : null}
      </View>
      <View style={tw`flex-row flex-wrap items-center gap-x-3`}>
        {onEditContact ? (
          <LinkButton
            icon={user.isContact ? Pencil : UserPlus}
            label={user.isContact ? 'Edit contact' : 'Add to contacts'}
            onPress={() => onEditContact(user)}
          />
        ) : null}
        {user.isBlocked ? (
          <LinkButton icon={Ban} label="Unblock" onPress={() => void confirmUnblock(user)} />
        ) : (
          <LinkButton icon={Ban} label="Block" danger onPress={() => void confirmBlock(user)} />
        )}
        <LinkButton
          label="View full profile"
          style={tw`ml-auto`}
          onPress={() => {
            onNavigate?.();
            router.push(`/u/${user.username}`);
          }}
        />
      </View>
    </>
  );
}

function SelfActions({ note, onNavigate, onSetStatus }) {
  const { tw, c } = useTheme();
  const router = useRouter();
  return (
    <>
      <AvailabilityPicker />
      {onSetStatus ? (
        <Press
          onPress={onSetStatus}
          style={tw`min-h-11 flex-row items-center gap-3 rounded-xl bg-surface-2 px-3 py-1.5`}
        >
          <Icon icon={Smile} size={18} color={c.muted} />
          <T numberOfLines={1} style={tw`min-w-0 flex-1 text-[14.5px]`}>
            {note ? formatPresenceNote(note) : 'Set a custom status'}
          </T>
          {note ? <T style={tw`text-[12px] text-muted`}>Edit</T> : null}
        </Press>
      ) : null}
      <Button
        variant="soft"
        leftIcon={Pencil}
        fullWidth
        onPress={() => {
          onNavigate?.();
          router.push('/settings/profile');
        }}
      >
        Edit profile
      </Button>
    </>
  );
}
