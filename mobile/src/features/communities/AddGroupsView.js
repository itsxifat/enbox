/**
 * Community admins (web AddGroupsView.tsx): create a new group inside the community, or link
 * existing groups they admin.
 */
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link2, Plus, UsersRound } from 'lucide-react-native';
import { chatTitle } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/avatars';
import { ICON_STROKE_ON_FILL, Icon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, EmptyState, Press, T, toast } from '@/components/ui';
import { GroupCreateFlow } from '@/features/groups/GroupCreateFlow';
import { RoundCheck } from '@/features/groups/shared/UserPicker';
import { useChats } from '@/stores/chats';
import { useCommunities } from '@/stores/communities';
import { useTheme } from '@/theme';

/** Groups the viewer may link to a community (server: admin of the group, not linked). */
export function linkableGroups(byId) {
  return Object.values(byId)
    .filter(
      (g) =>
        g.type === 'group' &&
        !g.isAnnouncement &&
        !g.communityId &&
        g.membership === 'active' &&
        (g.myRole === 'owner' || g.myRole === 'admin'),
    )
    .sort((a, b) => chatTitle(a).localeCompare(chatTitle(b)));
}

function MenuRow({ icon, title, description, onPress }) {
  const { tw, c } = useTheme();
  return (
    <Press onPress={onPress} style={tw`flex-row items-center gap-4 px-5 py-3`}>
      <View style={tw`size-12 items-center justify-center rounded-full bg-brand`}>
        <Icon icon={icon} size={22} strokeWidth={ICON_STROKE_ON_FILL} color={c['on-brand']} />
      </View>
      <View style={tw`min-w-0 flex-1`}>
        <T style={tw`text-[16px] font-medium`}>{title}</T>
        <T style={tw`text-[13px] text-muted`}>{description}</T>
      </View>
    </Press>
  );
}

/** A tappable group row with a round check (link existing groups / new community). */
export function GroupCheckRow({ group: g, checked, onToggle }) {
  const { tw } = useTheme();
  return (
    <Press
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={chatTitle(g)}
      onPress={onToggle}
      style={tw`flex-row items-center gap-3 px-5 py-2.5`}
    >
      <ChatAvatar chat={g} size="md" />
      <View style={tw`min-w-0 flex-1`}>
        <T numberOfLines={1} style={tw`text-[15.5px] font-medium`}>
          {chatTitle(g)}
        </T>
        <T numberOfLines={1} style={tw`text-[13px] text-muted`}>
          {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}
        </T>
      </View>
      <RoundCheck checked={checked} />
    </Press>
  );
}

export function AddGroupsView({ community: c, onClose }) {
  const { tw } = useTheme();
  const router = useRouter();
  const [view, setView] = useState('menu');

  if (view === 'create')
    return (
      <GroupCreateFlow
        communityId={c.id}
        communityName={c.name}
        onCancel={() => setView('menu')}
        onCreated={(chat) => {
          void useCommunities
            .getState()
            .refreshCommunity(c.id)
            .catch(() => undefined);
          onClose();
          router.push(`/chats/${chat.id}`);
        }}
      />
    );
  if (view === 'existing')
    return <LinkExisting community={c} onBack={() => setView('menu')} onDone={onClose} />;

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="Add groups" subtitle={c.name} back={onClose} />
      <View style={tw`py-2`}>
        <MenuRow
          icon={Plus}
          title="Create new group"
          description="Start a group that community members can find and join"
          onPress={() => setView('create')}
        />
        <MenuRow
          icon={Link2}
          title="Add existing groups"
          description="Bring in groups you're an admin of"
          onPress={() => setView('existing')}
        />
      </View>
    </View>
  );
}

function LinkExisting({ community: c, onBack, onDone }) {
  const { tw, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const byId = useChats((s) => s.byId);
  const groups = useMemo(() => linkableGroups(byId), [byId]);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const toggle = (id) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const link = async () => {
    setBusy(true);
    try {
      await useCommunities.getState().linkGroups(c.id, [...picked]);
      toast.success(picked.size === 1 ? 'Group added to the community' : `${picked.size} groups added`);
      onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title="Add existing groups"
        subtitle={picked.size ? `${picked.size} selected` : c.name}
        back={onBack}
      />
      <ScrollView style={tw`min-h-0 flex-1`} contentContainerStyle={tw`pb-24`}>
        {groups.length ? (
          <>
            <T style={tw`px-5 pt-3 pb-1 text-[13px] text-muted`}>
              Groups you admin that aren't in a community. Their members become community members.
            </T>
            {groups.map((g) => (
              <GroupCheckRow key={g.id} group={g} checked={picked.has(g.id)} onToggle={() => toggle(g.id)} />
            ))}
          </>
        ) : (
          <EmptyState
            compact
            icon={UsersRound}
            title="No groups to add"
            description="You can add groups where you're an admin and that don't belong to another community."
          />
        )}
      </ScrollView>
      {picked.size ? (
        <View
          style={[
            tw`absolute inset-x-3 rounded-xl bg-surface-2 px-4 py-3`,
            { bottom: Math.max(12, insets.bottom) },
            shadow.elevated,
          ]}
        >
          <Button fullWidth size="lg" loading={busy} onPress={() => void link()}>
            {`Add ${picked.size === 1 ? 'group' : `${picked.size} groups`}`}
          </Button>
        </View>
      ) : null}
    </View>
  );
}
