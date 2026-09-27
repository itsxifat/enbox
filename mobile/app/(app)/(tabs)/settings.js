import { View } from 'react-native';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { useTheme } from '@/theme';

export default function Screen() {
  const { tw } = useTheme();
  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="settings" large />
    </View>
  );
}
