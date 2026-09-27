/**
 * My status updates (web features/status/MyStatusPane.tsx): every live status of mine with
 * its time and view count; open one in the viewer, delete, or add another.
 */
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Camera, Eye, Pencil, Trash2 } from 'lucide-react-native';
import { Icon, UpdatesIcon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { EmptyState, IconButton, ListSection, Press, T, confirm, toast } from '@/components/ui';
import { formatRelativeShort } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { useStatus, useStatusLists } from '@/stores/status';
import { useTheme } from '@/theme';
import { useMediaPicker } from './StatusSection';
import { StatusThumb } from './StatusRing';

async function remove(status) {
  const ok = await confirm({
    title: 'Delete this status update?',
    message: 'It will also be deleted for everyone who received it.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await useStatus.getState().deleteStatus(status.id);
    toast.success('Status deleted');
  } catch (e) {
    toast.error(e);
  }
}

export function MyStatusPane() {
  const { tw, c } = useTheme();
  const router = useRouter();
  const me = useMe();
  const { mine } = useStatusLists();
  const pickMedia = useMediaPicker();
  const newest = [...mine].reverse();

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title="My status"
        subtitle={mine.length ? `${mine.length} update${mine.length === 1 ? '' : 's'}` : undefined}
        back="/updates"
        actions={
          <>
            <IconButton
              icon={Pencil}
              label="New text status"
              onPress={() => router.push('/updates/status/new')}
            />
            <IconButton
              icon={Camera}
              label="New photo or video status"
              onPress={() => void pickMedia()}
            />
          </>
        }
      />
      <ScrollView style={tw`min-h-0 flex-1`} contentContainerStyle={tw`pb-6`}>
        {newest.length === 0 ? (
          <EmptyState
            icon={UpdatesIcon}
            title="No status updates"
            description="Share text, photos and videos with your contacts. They disappear after 24 hours."
          />
        ) : (
          <ListSection title="Your updates">
            {newest.map((s) => (
              <View
                key={s.id}
                style={tw`mx-2 my-0.5 flex-row items-center gap-3 rounded-xl px-2.5`}
              >
                <Press
                  feedback={false}
                  style={tw`min-w-0 flex-1 flex-row items-center gap-3 py-2`}
                  onPress={() =>
                    me &&
                    router.push({
                      pathname: `/updates/status/${me.id}`,
                      params: { startId: s.id },
                    })
                  }
                  accessibilityLabel={`Open status from ${formatRelativeShort(s.createdAt)}`}
                >
                  <View
                    style={[
                      tw`size-12 overflow-hidden rounded-full`,
                      {
                        boxShadow: `0px 0px 0px 2px ${c.surface}, 0px 0px 0px 4px ${c['line-strong']}`,
                      },
                    ]}
                  >
                    <StatusThumb status={s} size={48} />
                  </View>
                  <View style={tw`min-w-0 flex-1 py-2`}>
                    <T numberOfLines={1} style={tw`text-[15.5px] font-medium`}>
                      {s.type === 'text'
                        ? s.text
                        : s.text || (s.type === 'image' ? 'Photo' : 'Video')}
                    </T>
                    <View style={tw`flex-row items-center gap-2`}>
                      <T style={tw`text-[13.5px] text-muted`}>{formatRelativeShort(s.createdAt)}</T>
                      <View
                        style={tw`flex-row items-center gap-1`}
                        accessibilityLabel={`${s.viewCount ?? 0} views`}
                      >
                        <Icon icon={Eye} size={14} color={c.muted} />
                        <T style={tw`text-[13.5px] text-muted`}>{s.viewCount ?? 0}</T>
                      </View>
                    </View>
                  </View>
                </Press>
                <IconButton icon={Trash2} label="Delete status" onPress={() => void remove(s)} />
              </View>
            ))}
          </ListSection>
        )}
        <T style={tw`px-6 pt-4 text-center text-[12.5px] text-subtle`}>
          Your status updates disappear after 24 hours.
        </T>
      </ScrollView>
    </View>
  );
}
