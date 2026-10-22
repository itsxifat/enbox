/**
 * Spaces tab. Communities became Spaces (Discord-style servers); until the app gets Spaces
 * this tab sends people to Spaces on the web.
 */
import { View } from 'react-native';
import { ExternalLink, UsersRound } from 'lucide-react-native';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, EmptyState } from '@/components/ui';
import { openSpacesOnWeb } from '@/lib/links';
import { useTheme } from '@/theme';

export default function SpacesScreen() {
  const { tw } = useTheme();
  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="Spaces" large />
      <EmptyState
        icon={UsersRound}
        title="Spaces are on the web for now"
        description="Communities are now Spaces, with text and voice channels, roles and permissions. They're coming to the app soon. Until then, open them in your browser."
        action={
          <Button onPress={() => void openSpacesOnWeb()} leftIcon={ExternalLink}>
            Open Spaces on the web
          </Button>
        }
      />
    </View>
  );
}
