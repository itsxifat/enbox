/**
 * Phone bottom tab bar (web components/layout/BottomTabs.tsx): a floating rounded card with a
 * margin above the safe area; the active tab gets a brand-soft pill and its filled icon.
 * Used as the expo-router `<Tabs tabBar>`.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CallsFilledIcon,
  CallsIcon,
  ChatsFilledIcon,
  ChatsIcon,
  CommunitiesFilledIcon,
  CommunitiesIcon,
  SettingsFilledIcon,
  SettingsIcon,
  UpdatesFilledIcon,
  UpdatesIcon,
  Icon,
} from '@/components/icons';
import { Badge, T } from '@/components/ui';
import { useMissedCallsCount } from '@/features/calls/hooks';
import { useChats, useUnreadChannelsCount, useUnreadChatsCount } from '@/stores/chats';
import { useHasUnseenStatus } from '@/stores/status';
import { useTheme } from '@/theme';

export const TABS = [
  { id: 'chats', label: 'Chats', icon: ChatsIcon, activeIcon: ChatsFilledIcon },
  { id: 'updates', label: 'Updates', icon: UpdatesIcon, activeIcon: UpdatesFilledIcon },
  {
    id: 'communities',
    label: 'Communities',
    icon: CommunitiesIcon,
    activeIcon: CommunitiesFilledIcon,
  },
  { id: 'calls', label: 'Calls', icon: CallsIcon, activeIcon: CallsFilledIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, activeIcon: SettingsFilledIcon },
];

/** Badges for the nav: unread chats count, Updates dot (unseen status / unread channels), missed calls. */
export function useTabBadges() {
  const unread = useUnreadChatsCount();
  const unseenStatus = useHasUnseenStatus();
  const unreadChannels = useUnreadChannelsCount();
  const missedCalls = useMissedCallsCount();
  const loaded = useChats((s) => s.loaded);
  return {
    chats: loaded && unread ? { count: unread } : undefined,
    updates: unseenStatus || unreadChannels ? { dot: true } : undefined,
    calls: missedCalls ? { count: missedCalls } : undefined,
  };
}

function TabIcon({ tab, active }) {
  const { c } = useTheme();
  const pop = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) return;
    pop.setValue(0.82);
    Animated.timing(pop, {
      toValue: 1,
      duration: 240,
      easing: Easing.bezier(0.2, 0.9, 0.3, 1.5),
      useNativeDriver: true,
    }).start();
  }, [active, pop]);
  return (
    <Animated.View style={{ transform: [{ scale: pop }] }}>
      <Icon
        icon={active ? tab.activeIcon : tab.icon}
        size={24}
        color={active ? c['brand-ink'] : c.muted}
      />
    </Animated.View>
  );
}

export function BottomTabs({ state, navigation }) {
  const { tw, c, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const badges = useTabBadges();
  const current = state.routes[state.index]?.name;
  return (
    <View style={[tw`bg-app px-3 pt-2`, { paddingBottom: Math.max(12, insets.bottom) }]}>
      <View
        style={[
          tw`w-full flex-row items-stretch justify-around self-center rounded-2xl bg-surface px-1`,
          { maxWidth: 576 },
          shadow.elevated,
        ]}
        accessibilityRole="tablist"
      >
        {TABS.map((t) => {
          const route = state.routes.find((r) => r.name === t.id);
          if (!route) return null;
          const active = current === t.id;
          const badge = badges[t.id];
          return (
            <Pressable
              key={t.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t.label}
              onPress={() => {
                const e = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!active && !e.defaultPrevented) navigation.navigate(route.name);
              }}
              style={tw`flex-1 items-center gap-1 pt-2 pb-2`}
            >
              {({ pressed }) => (
                <>
                  <View
                    style={[
                      tw`relative h-8 w-16 items-center justify-center rounded-full`,
                      {
                        backgroundColor: active
                          ? c['brand-soft']
                          : pressed
                            ? c.hover
                            : 'transparent',
                      },
                    ]}
                  >
                    <TabIcon tab={t} active={active} />
                    {badge?.count ? (
                      <Badge
                        count={badge.count}
                        size="sm"
                        tone="danger"
                        ring
                        style={{ position: 'absolute', top: -6, left: 32 }}
                      />
                    ) : badge?.dot ? (
                      <Badge
                        dot
                        tone="danger"
                        ring
                        style={{ position: 'absolute', top: 0, right: 16 }}
                      />
                    ) : null}
                  </View>
                  <T
                    numberOfLines={1}
                    style={[
                      tw`text-[12px]`,
                      { lineHeight: 14 },
                      active ? tw`font-semibold text-fg` : tw`font-medium text-muted`,
                    ]}
                  >
                    {t.label}
                  </T>
                </>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
