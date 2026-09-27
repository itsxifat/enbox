/** A settings page, full screen with a back arrow (web SettingsSectionPage on phones). */
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SearchX } from 'lucide-react-native';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { EmptyState } from '@/components/ui';
import { useTheme } from '@/theme';
import { SETTINGS_PAGES } from './registry';

export function SettingsSectionScreen() {
  const { tw } = useTheme();
  const { section = '', sub } = useLocalSearchParams();
  const key = sub ? `${section}/${sub}` : section;
  const page = SETTINGS_PAGES[key];
  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title={page?.title ?? 'Settings'} back="/settings" />
      {page ? (
        page.render()
      ) : (
        <View style={tw`flex-1 items-center justify-center`}>
          <EmptyState
            icon={SearchX}
            title="Page not found"
            description="This settings page doesn't exist."
          />
        </View>
      )}
    </View>
  );
}
