/** Archived chats (/archived; web features/chats/ArchivedPane.tsx): same rows and menus as the main list. */
import { useCallback } from 'react';
import { FlatList, View } from 'react-native';
import { Archive } from 'lucide-react-native';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { EmptyState, ListItemSkeleton, T } from '@/components/ui';
import { useChats, useSortedChats } from '@/stores/chats';
import { useTheme } from '@/theme';
import { ChatRow } from './ChatRow';

function Note() {
  const { tw } = useTheme();
  return (
    <T style={tw`px-6 py-3 text-center text-[13px] text-muted`}>
      These chats stay archived when new messages are received.
    </T>
  );
}

export function ArchivedScreen() {
  const { tw } = useTheme();
  const loaded = useChats((s) => s.loaded);
  const chats = useSortedChats({ archived: true });
  const renderRow = useCallback(({ item }) => <ChatRow chat={item} />, []);
  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="Archived" back="/chats" />
      {!loaded ? (
        <ListItemSkeleton count={4} />
      ) : chats.length ? (
        <FlatList
          style={tw`min-h-0 flex-1`}
          data={chats}
          keyExtractor={(c) => c.id}
          ListHeaderComponent={Note}
          renderItem={renderRow}
        />
      ) : (
        <EmptyState
          icon={Archive}
          title="No archived chats"
          description="Archive a chat from its menu to tidy up your chat list without deleting it."
        />
      )}
    </View>
  );
}
