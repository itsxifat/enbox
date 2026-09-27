/**
 * /welcome — optional onboarding right after registering (web features/auth/WelcomePage):
 * profile photo, name, about and notifications. "Continue" / "Skip" go to the chats.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { BellRing, Check } from 'lucide-react-native';
import { ABOUT_MAX_LENGTH, DEFAULT_ABOUT, DISPLAY_NAME_MAX_LENGTH } from '@enbox/shared';
import { Icon } from '@/components/icons';
import { Button, Input, Press, T, toast } from '@/components/ui';
import { AuthLayout } from '@/features/auth/AuthUi';
import { AvatarEditor } from '@/features/settings/ProfileEditors';
import { ABOUT_PRESETS, updateProfile } from '@/features/settings/settingsApi';
import {
  checkNotificationPermission,
  notificationPermission,
  requestNotificationPermission,
} from '@/lib/notify';
import { useMe } from '@/stores/auth';
import { useTheme } from '@/theme';

const QUICK_ABOUT = [DEFAULT_ABOUT, ...ABOUT_PRESETS.slice(0, 4)];

export default function WelcomeScreen() {
  const { tw, c } = useTheme();
  const me = useMe();
  const router = useRouter();
  const [name, setName] = useState(me?.displayName ?? '');
  const [about, setAbout] = useState(me?.about ?? DEFAULT_ABOUT);
  const [nameError, setNameError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState(() => notificationPermission());
  const [enabling, setEnabling] = useState(false);
  useEffect(() => {
    void checkNotificationPermission().then(setPermission);
  }, []);
  if (!me) return null;

  const done = () => router.replace('/chats');

  const submit = async () => {
    if (!name.trim()) {
      setNameError('Enter your name');
      return;
    }
    const patch = {};
    if (name.trim() !== me.displayName) patch.displayName = name.trim();
    if (about.trim() !== me.about) patch.about = about.trim();
    if (Object.keys(patch).length) {
      setBusy(true);
      try {
        await updateProfile(patch);
      } catch (err) {
        toast.error(err);
        setBusy(false);
        return;
      }
    }
    toast.success(`Welcome to Enbox, ${name.trim().split(/\s+/)[0]}!`);
    done();
  };

  const turnOnNotifications = async () => {
    setEnabling(true);
    try {
      setPermission(await requestNotificationPermission());
    } finally {
      setEnabling(false);
    }
  };

  return (
    <AuthLayout
      title="Set up your profile"
      subtitle="Add a photo and a few words so friends know it’s you. You can change these any time in Settings."
    >
      <View style={tw`gap-5`}>
        <View style={tw`items-center py-2`}>
          <AvatarEditor size={128} />
        </View>
        <Input
          label="Your name"
          value={name}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          autoComplete="name"
          onChangeText={(v) => {
            setName(v);
            setNameError(null);
          }}
          error={nameError ?? undefined}
        />
        <View style={tw`gap-2`}>
          <Input
            label="About"
            aside={`${ABOUT_MAX_LENGTH - Array.from(about).length}`}
            value={about}
            maxLength={ABOUT_MAX_LENGTH}
            onChangeText={setAbout}
          />
          <View style={tw`flex-row flex-wrap gap-2`}>
            {QUICK_ABOUT.map((p) => {
              const on = about === p;
              return (
                <Press
                  key={p}
                  onPress={() => setAbout(p)}
                  accessibilityState={{ selected: on }}
                  feedback={false}
                  style={({ pressed }) => [
                    tw`h-8 justify-center rounded-full px-3`,
                    {
                      backgroundColor: on ? c['brand-soft'] : pressed ? c.line : c['surface-2'],
                    },
                  ]}
                >
                  <T
                    style={[tw`text-[13px] font-medium`, { color: on ? c['brand-ink'] : c.muted }]}
                  >
                    {p}
                  </T>
                </Press>
              );
            })}
          </View>
        </View>

        {permission === 'default' || permission === 'granted' ? (
          <View style={tw`flex-row items-center gap-3 rounded-2xl border border-line p-3.5`}>
            <View style={tw`size-10 items-center justify-center rounded-full bg-brand-soft`}>
              <Icon icon={BellRing} size={20} color={c['brand-ink']} />
            </View>
            <View style={tw`min-w-0 flex-1`}>
              <T style={tw`text-[15px] font-medium`}>Notifications</T>
              <T style={tw`text-[13px] text-muted`}>
                {permission === 'granted'
                  ? 'You’ll be notified about new messages and calls.'
                  : 'Get notified about new messages and calls.'}
              </T>
            </View>
            {permission === 'granted' ? (
              <Icon icon={Check} size={20} color={c.success} />
            ) : (
              <Button
                size="sm"
                variant="soft"
                loading={enabling}
                onPress={() => void turnOnNotifications()}
              >
                Turn on
              </Button>
            )}
          </View>
        ) : null}

        <View style={tw`mt-1 gap-2`}>
          <Button size="lg" fullWidth loading={busy} onPress={() => void submit()}>
            Continue
          </Button>
          <Button variant="ghost" fullWidth onPress={done} disabled={busy}>
            Skip for now
          </Button>
        </View>
      </View>
    </AuthLayout>
  );
}
