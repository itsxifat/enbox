/**
 * Updates tab (web features/updates/UpdatesPane.tsx): the Status section and the Channels
 * section.
 */
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Camera, Compass, EllipsisVertical, History, Megaphone } from 'lucide-react-native';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { DropdownMenu, IconButton } from '@/components/ui';
import { ChannelsSection } from '@/features/channels/ChannelsSection';
import { StatusSection } from '@/features/status/StatusSection';
import { useTheme } from '@/theme';

export default function UpdatesScreen() {
  const { tw } = useTheme();
  const router = useRouter();
  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title="Updates"
        large
        actions={
          <>
            <IconButton
              icon={Camera}
              label="Add status"
              onPress={() => router.push('/updates/status/new')}
            />
            <DropdownMenu
              trigger={(p) => <IconButton {...p} icon={EllipsisVertical} label="Menu" />}
              items={[
                {
                  label: 'My status updates',
                  icon: History,
                  onSelect: () => router.push('/updates/status/mine'),
                },
                {
                  label: 'Create channel',
                  icon: Megaphone,
                  onSelect: () => router.push('/updates/channels/new'),
                },
                {
                  label: 'Find channels',
                  icon: Compass,
                  onSelect: () => router.push('/updates/channels/discover'),
                },
              ]}
            />
          </>
        }
      />
      <ScrollView style={tw`min-h-0 flex-1`} contentContainerStyle={tw`pb-4`}>
        <StatusSection />
        <View style={tw`mx-4 my-2 h-px bg-line`} />
        <ChannelsSection />
      </ScrollView>
    </View>
  );
}
