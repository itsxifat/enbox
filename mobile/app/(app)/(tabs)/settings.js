/**
 * Settings tab (web features/settings/SettingsPane.tsx): my profile card (the avatar opens my
 * profile card — availability, custom status), the sections, log out.
 */
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, LogOut } from 'lucide-react-native';
import { activePresenceNote } from '@enbox/shared';
import { Icon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Avatar, Press, T } from '@/components/ui';
import { selfPresenceState } from '@/features/profile/model';
import { openProfile } from '@/features/profile/open';
import { confirmLogout } from '@/features/settings/pages/AccountPages';
import { SETTINGS_SECTIONS } from '@/features/settings/sections';
import { IconTile } from '@/features/settings/ui';
import { formatPresenceNote } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { useTheme } from '@/theme';

export default function SettingsScreen() {
  const { tw, c } = useTheme();
  const router = useRouter();
  const me = useMe();
  const note = activePresenceNote(me?.presenceNote);
  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="Settings" large />
      <ScrollView style={tw`min-h-0 flex-1`} contentContainerStyle={tw`pb-4`}>
        {me ? (
          <Press
            onPress={() => router.push('/settings/profile')}
            style={tw`mx-2 mb-2 flex-row items-center gap-4 rounded-xl bg-surface-2 px-3 py-3`}
          >
            <Press
              feedback={false}
              accessibilityLabel="Your profile card"
              onPress={() => openProfile(me.id)}
              style={tw`rounded-full`}
            >
              <Avatar
                src={me.avatarUrl}
                animatedSrc={me.avatarAnimatedUrl}
                name={me.displayName}
                colorSeed={me.id}
                size="xl"
                presence={selfPresenceState(me)}
              />
            </Press>
            <View style={tw`min-w-0 flex-1 gap-0.5`}>
              <T numberOfLines={1} style={tw`text-[19px] font-semibold`}>
                {me.displayName}
              </T>
              <T numberOfLines={1} style={tw`text-[14px] text-muted`}>
                {note ? formatPresenceNote(note) : me.about || `@${me.username}`}
              </T>
            </View>
            <Icon icon={ChevronRight} size={18} color={c.subtle} />
          </Press>
        ) : null}
        <View style={tw`mx-2 rounded-xl bg-surface-2 p-1`}>
          {SETTINGS_SECTIONS.filter((s) => s.id !== 'profile').map((s) => (
            <Press
              key={s.id}
              onPress={() => router.push(`/settings/${s.id}`)}
              style={tw`flex-row items-center gap-4 rounded-xl px-3 py-2.5`}
            >
              <IconTile icon={s.icon} color={s.tint} />
              <View style={tw`min-w-0 flex-1`}>
                <T style={tw`text-[16px]`}>{s.title}</T>
                <T numberOfLines={1} style={tw`text-[13.5px] text-muted`}>
                  {s.description}
                </T>
              </View>
              <Icon icon={ChevronRight} size={18} color={c.subtle} />
            </Press>
          ))}
        </View>
        <View style={tw`mx-2 mt-2 rounded-xl bg-surface-2 p-1`}>
          <Press
            onPress={() => void confirmLogout()}
            style={tw`flex-row items-center gap-4 rounded-xl px-3 py-2.5`}
          >
            <IconTile icon={LogOut} color={c['danger-fill']} />
            <T style={tw`text-[16px] text-danger`}>Log out</T>
          </Press>
        </View>
        <T style={tw`mt-6 px-6 text-center text-[12px] text-subtle`}>
          Enbox · Your chats stay in sync across all your devices
        </T>
      </ScrollView>
    </View>
  );
}
