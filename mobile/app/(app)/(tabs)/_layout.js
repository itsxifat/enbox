/** The five tabs with the floating Enbox tab bar (web BottomTabs). */
import { Tabs } from 'expo-router';
import { BottomTabs } from '@/components/layout/BottomTabs';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs
      tabBar={(props) => <BottomTabs {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.surface },
        animation: 'none',
      }}
    >
      <Tabs.Screen name="chats" />
      <Tabs.Screen name="updates" />
      <Tabs.Screen name="communities" />
      <Tabs.Screen name="calls" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
