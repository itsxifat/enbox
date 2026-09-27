/**
 * The "Status" section of the Updates tab (web features/status/StatusSection.tsx): My status
 * (add / view mine / posting progress), Recent updates (unseen first) and Viewed updates,
 * each row with a segmented ring around the latest status preview.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Camera, EllipsisVertical, Lock, Pencil, Plus } from 'lucide-react-native';
import { userDisplayName } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { ICON_STROKE_BOLD, Icon, UpdatesIcon } from '@/components/icons';
import { DropdownMenu, IconButton, ListSection, Press, Skeleton, T, toast } from '@/components/ui';
import { pickOne } from '@/lib/imagePick';
import { formatRelativeShort } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { useStatus, useStatusLists } from '@/stores/status';
import { useTheme } from '@/theme';
import { setPendingStatusFile } from './media';
import { StatusPrivacyDialog } from './StatusPrivacyDialog';
import { StatusRing, StatusThumb } from './StatusRing';

const RING = 52;

/** Pick a photo/video (gallery or camera) and open the composer with it. */
export function useMediaPicker() {
  const router = useRouter();
  return async () => {
    const file = await pickOne({ video: true, title: 'Status' });
    if (!file) return;
    setPendingStatusFile(file);
    router.push('/updates/status/new');
  };
}

function MyStatusRow() {
  const { tw, c } = useTheme();
  const me = useMe();
  const { mine } = useStatusLists();
  const posting = useStatus((s) => s.posting);
  const router = useRouter();
  const pickMedia = useMediaPicker();
  const latest = mine[mine.length - 1];
  const progress = posting.length
    ? Math.round((posting.reduce((a, p) => a + p.progress, 0) / posting.length) * 100)
    : null;
  const subtitle =
    progress !== null
      ? `Sending…${posting.some((p) => p.type !== 'text') ? ` ${progress}%` : ''}`
      : latest
        ? `${formatRelativeShort(latest.createdAt)}${latest.viewCount ? ` · ${latest.viewCount} view${latest.viewCount === 1 ? '' : 's'}` : ''}`
        : 'Tap to add status update';

  return (
    <View style={tw`relative flex-row items-center`}>
      <Press
        style={tw`min-w-0 flex-1 flex-row items-center gap-3 px-3 py-2`}
        onPress={() =>
          mine.length && me
            ? router.push(`/updates/status/${me.id}`)
            : router.push('/updates/status/new')
        }
        accessibilityLabel={
          mine.length
            ? `My status, ${mine.length} update${mine.length === 1 ? '' : 's'}`
            : 'Add status update'
        }
      >
        <View style={tw`py-0.5`}>
          {latest ? (
            <StatusRing statuses={mine.map((s) => ({ ...s, viewed: true }))} size={RING}>
              <StatusThumb status={latest} size={RING - 9} />
            </StatusRing>
          ) : (
            <View style={tw`p-0.5`}>
              {me ? <UserAvatar user={{ ...me, contactName: null }} size={RING - 4} /> : null}
            </View>
          )}
          {!latest ? (
            <View
              style={[
                tw`absolute -right-0.5 bottom-0 size-5 items-center justify-center rounded-full bg-brand`,
                { borderWidth: 2, borderColor: c.surface },
              ]}
            >
              <Icon icon={Plus} size={12} strokeWidth={ICON_STROKE_BOLD} color={c['on-brand']} />
            </View>
          ) : null}
        </View>
        <View style={tw`min-w-0 flex-1 pr-20`}>
          <T numberOfLines={1} style={tw`text-[16px] font-medium`}>
            My status
          </T>
          <T
            numberOfLines={1}
            style={[tw`text-[14px]`, progress !== null ? tw`text-brand-ink` : tw`text-muted`]}
          >
            {subtitle}
          </T>
        </View>
      </Press>
      <View style={tw`absolute right-2 flex-row items-center gap-0.5`}>
        <IconButton
          icon={Pencil}
          label="New text status"
          size="sm"
          onPress={() => router.push('/updates/status/new')}
        />
        <IconButton
          icon={Camera}
          label="New photo or video status"
          size="sm"
          onPress={() => void pickMedia()}
        />
      </View>
    </View>
  );
}

function UpdateRow({ item }) {
  const { tw } = useTheme();
  const router = useRouter();
  const latest = item.statuses[item.statuses.length - 1];
  const name = userDisplayName(item.user);
  return (
    <Press
      onPress={() => router.push(`/updates/status/${item.user.id}`)}
      accessibilityLabel={`${name}, ${item.allViewed ? 'viewed' : 'new status update'}, ${formatRelativeShort(item.lastUpdatedAt)}`}
      style={tw`flex-row items-center gap-3 px-3 py-2`}
    >
      <StatusRing statuses={item.statuses} size={RING} style={tw`my-0.5`}>
        <StatusThumb status={latest} size={RING - 9} />
      </StatusRing>
      <View style={tw`min-w-0 flex-1`}>
        <T numberOfLines={1} style={tw`text-[16px] font-medium`}>
          {name}
        </T>
        <T numberOfLines={1} style={tw`text-[14px] text-muted`}>
          {formatRelativeShort(item.lastUpdatedAt)}
        </T>
      </View>
    </Press>
  );
}

function SubHeader({ children }) {
  const { tw } = useTheme();
  return <T style={tw`px-4 pt-3 pb-1 text-[13px] font-medium text-muted`}>{children}</T>;
}

export function StatusSection() {
  const { tw } = useTheme();
  const { recent, viewed, mine } = useStatusLists();
  const router = useRouter();
  const loaded = useStatus((s) => s.loaded);
  const error = useStatus((s) => s.error);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    const s = useStatus.getState();
    if (!s.loaded && !s.loading) void s.loadFeed().catch(() => undefined);
    s.pruneExpired();
    const id = setInterval(() => useStatus.getState().pruneExpired(), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <ListSection
      title="Status"
      action={
        <DropdownMenu
          trigger={(t) => (
            <IconButton {...t} icon={EllipsisVertical} label="Status options" size="sm" />
          )}
          items={[
            mine.length
              ? {
                  label: 'My status updates',
                  icon: UpdatesIcon,
                  onSelect: () => router.push('/updates/status/mine'),
                }
              : null,
            { label: 'Status privacy', icon: Lock, onSelect: () => setPrivacyOpen(true) },
          ]}
        />
      }
    >
      <MyStatusRow />
      {!loaded && !error ? (
        <View style={tw`gap-3 px-4 py-3`}>
          {[0, 1].map((i) => (
            <View key={i} style={tw`flex-row items-center gap-3`}>
              <Skeleton circle style={{ width: 52, height: 52 }} />
              <View style={tw`flex-1 gap-2`}>
                <Skeleton style={tw`h-3.5 w-1/3`} />
                <Skeleton style={tw`h-3 w-1/4`} />
              </View>
            </View>
          ))}
        </View>
      ) : error && !loaded ? (
        <Press
          feedback={false}
          style={tw`mx-4 my-2`}
          onPress={() =>
            void useStatus
              .getState()
              .loadFeed()
              .catch((e) => toast.error(e))
          }
        >
          <T style={tw`text-[14px] text-danger`}>Couldn't load status updates. Tap to retry.</T>
        </Press>
      ) : null}
      {recent.length ? (
        <>
          <SubHeader>Recent updates</SubHeader>
          {recent.map((item) => (
            <UpdateRow key={item.user.id} item={item} />
          ))}
        </>
      ) : null}
      {viewed.length ? (
        <>
          <SubHeader>Viewed updates</SubHeader>
          {viewed.map((item) => (
            <UpdateRow key={item.user.id} item={item} />
          ))}
        </>
      ) : null}
      {loaded && !recent.length && !viewed.length ? (
        <T style={tw`px-4 pt-1 pb-2 text-[13px] text-subtle`}>
          Status updates from your contacts will appear here.
        </T>
      ) : null}
      <StatusPrivacyDialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </ListSection>
  );
}
