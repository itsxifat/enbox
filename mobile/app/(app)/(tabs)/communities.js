/**
 * Communities tab (web features/communities/CommunitiesPane.tsx): "New community", then each
 * community with its announcements and the groups I'm in.
 */
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, Plus, UsersRound } from 'lucide-react-native';
import { ICON_STROKE_BOLD, Icon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  ListItemSkeleton,
  Press,
  T,
  toast,
} from '@/components/ui';
import { CommunityChatRow } from '@/features/communities/CommunityChatRow';
import { useCommunities, useSortedCommunities } from '@/stores/communities';
import { useTheme } from '@/theme';

const GROUPS_PREVIEW = 3;

function CommunityBlock({ community: c }) {
  const { tw, c: col } = useTheme();
  const router = useRouter();
  const mine = c.groups.filter((g) => !g.isAnnouncement && g.isMember);
  const groupCount = c.groups.filter((g) => !g.isAnnouncement).length;
  return (
    <View style={[tw`mt-2`, { borderTopWidth: 8, borderTopColor: col.app }]}>
      <Press
        onPress={() => router.push(`/communities/${c.id}`)}
        style={tw`flex-row items-center gap-3 px-4 py-3`}
      >
        <Avatar src={c.avatarUrl} name={c.name} colorSeed={c.id} kind="community" size="lg" />
        <View style={tw`min-w-0 flex-1`}>
          <T numberOfLines={1} style={tw`text-[17px] font-semibold`}>
            {c.name}
          </T>
          <T numberOfLines={1} style={tw`text-[13px] text-muted`}>
            {groupCount} {groupCount === 1 ? 'group' : 'groups'} · {c.memberCount}{' '}
            {c.memberCount === 1 ? 'member' : 'members'}
          </T>
        </View>
        <Icon icon={ChevronRight} size={18} color={col.subtle} />
      </Press>
      <View style={tw`mx-4 h-px bg-line`} />
      <CommunityChatRow
        chatId={c.announcementChatId}
        name={c.name}
        avatarUrl={c.avatarUrl}
        announcement
        fallback="Welcome to the community!"
      />
      {mine.slice(0, GROUPS_PREVIEW).map((g) => (
        <CommunityChatRow
          key={g.chatId}
          chatId={g.chatId}
          name={g.name}
          avatarUrl={g.avatarUrl}
          fallback={`${g.memberCount} members`}
        />
      ))}
      <Press
        onPress={() => router.push(`/communities/${c.id}`)}
        style={[tw`flex-row items-center justify-between gap-3 py-3 pr-4`, { paddingLeft: 72 }]}
      >
        <T style={tw`text-[14.5px] font-medium text-brand-ink`}>
          {mine.length > GROUPS_PREVIEW
            ? `View all (${mine.length - GROUPS_PREVIEW} more)`
            : groupCount > mine.length
              ? `View all groups (${groupCount - mine.length} to join)`
              : 'View community'}
        </T>
        <Icon icon={ChevronRight} size={18} color={col['brand-ink']} />
      </Press>
    </View>
  );
}

export default function CommunitiesScreen() {
  const { tw, c } = useTheme();
  const router = useRouter();
  const loaded = useCommunities((s) => s.loaded);
  const communities = useSortedCommunities();

  useEffect(() => {
    void useCommunities
      .getState()
      .loadCommunities()
      .catch((e) => {
        if (!useCommunities.getState().loaded) toast.error(e);
      });
  }, []);

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title="Communities"
        large
        actions={
          <IconButton
            icon={Plus}
            label="New community"
            onPress={() => router.push('/communities/new')}
          />
        }
      />
      <ScrollView style={tw`min-h-0 flex-1`} contentContainerStyle={tw`pb-4`}>
        <Press
          onPress={() => router.push('/communities/new')}
          style={tw`flex-row items-center gap-3 px-4 py-3`}
        >
          <View style={tw`size-12 items-center justify-center rounded-[14px] bg-surface-2`}>
            <Icon icon={UsersRound} size={24} color={c.muted} />
            <View
              style={[
                tw`absolute -right-1 -bottom-1 size-5 items-center justify-center rounded-full bg-brand`,
                { borderWidth: 2, borderColor: c.surface },
              ]}
            >
              <Icon icon={Plus} size={12} strokeWidth={ICON_STROKE_BOLD} color={c['on-brand']} />
            </View>
          </View>
          <T style={tw`text-[16px] font-medium`}>New community</T>
        </Press>
        {!loaded ? (
          <ListItemSkeleton count={3} />
        ) : communities.length ? (
          communities.map((cm) => <CommunityBlock key={cm.id} community={cm} />)
        ) : (
          <EmptyState
            icon={UsersRound}
            title="Stay connected with a community"
            description="Communities bring members together in topic-based groups, and make it easy to get admin announcements. Any community you're added to will appear here."
            action={
              <Button onPress={() => router.push('/communities/new')} leftIcon={Plus}>
                Start your community
              </Button>
            }
          />
        )}
      </ScrollView>
    </View>
  );
}
