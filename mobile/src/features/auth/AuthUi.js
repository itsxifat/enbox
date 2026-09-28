/**
 * Auth frame and controls (web features/auth: AuthLayout, PasswordInput,
 * PasswordStrengthMeter) plus the app-only server picker (`ServerLink`): the Android app is
 * not served by the Enbox server, so a stock build talks to the built-in one and the picker
 * only appears once a custom server is set (or in dev builds).
 */
import { useState } from 'react';
import { View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertCircle, Eye, EyeOff, Server } from 'lucide-react-native';
import { Icon, LogoMark } from '@/components/icons';
import { Button, IconButton, Input, Modal, Press, T, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { getApiOrigin, isDefaultOrigin, normalizeOrigin, setApiOrigin } from '@/lib/env';
import { useTheme } from '@/theme';
import { passwordStrength } from './validation';

export function AuthLayout({ title, subtitle, children, footer }) {
  const { tw, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAwareScrollView
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      style={tw`flex-1 bg-surface`}
      contentContainerStyle={[
        tw`grow items-center justify-center px-5`,
        {
          paddingTop: Math.max(40, insets.top + 16),
          paddingBottom: Math.max(24, insets.bottom + 16),
        },
      ]}
    >
      <View style={[tw`w-full`, { maxWidth: 400 }]}>
        <View style={tw`mb-8 items-center`}>
          <View style={[tw`mb-6 rounded-[14px]`, shadow.card]}>
            <LogoMark size={56} />
          </View>
          <T
            style={[
              tw`text-center text-[26px] font-bold`,
              { letterSpacing: -0.65, lineHeight: 35.75 },
            ]}
          >
            {title}
          </T>
          {subtitle ? <T style={tw`mt-2 text-center text-[15px] text-muted`}>{subtitle}</T> : null}
        </View>
        {children}
        {footer ? <View style={tw`mt-8 items-center`}>{footer}</View> : null}
      </View>
    </KeyboardAwareScrollView>
  );
}

export function FormError({ children }) {
  const { tw, c } = useTheme();
  if (!children) return null;
  return (
    <View
      accessibilityRole="alert"
      style={tw`flex-row items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5`}
    >
      <Icon icon={AlertCircle} size={18} color={c.danger} style={{ marginTop: 1 }} />
      <T style={tw`min-w-0 flex-1 text-[14px] text-danger`}>{children}</T>
    </View>
  );
}

/** Password field with a show/hide toggle. */
export function PasswordInput(props) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      rightSlot={
        <IconButton
          icon={visible ? EyeOff : Eye}
          label={visible ? 'Hide password' : 'Show password'}
          size="sm"
          onPress={() => setVisible((v) => !v)}
        />
      }
    />
  );
}

const TONES = ['danger', 'danger', 'warning', 'success', 'success'];

/** Four-segment strength bar with a label (register / change password). */
export function PasswordStrengthMeter({ password }) {
  const { tw, c } = useTheme();
  const { score, label } = passwordStrength(password);
  if (!password) return null;
  const filled = Math.max(1, score);
  const tone = c[TONES[score]];
  return (
    <View style={tw`flex-row items-center gap-3`} accessibilityLiveRegion="polite">
      <View style={tw`flex-1 flex-row gap-1.5`}>
        {[1, 2, 3, 4].map((i) => (
          <View
            key={i}
            style={[
              tw`h-1.5 flex-1 rounded-full`,
              { backgroundColor: i <= filled ? tone : c.line },
            ]}
          />
        ))}
      </View>
      <T style={[tw`w-20 text-right text-[12px] font-medium`, { color: tone }]}>{label}</T>
    </View>
  );
}

/**
 * "Server: enbox.example.com" link under the auth forms + the sheet to change it. Hidden while
 * the app talks to its built-in server (stock builds never ask for an address); `forceOpen`
 * only opens the sheet when no server is configured at all (custom builds without a default).
 */
export function ServerLink({ forceOpen = false }) {
  const { tw, c } = useTheme();
  const [open, setOpen] = useState(forceOpen && !getApiOrigin());
  const [value, setValue] = useState(getApiOrigin());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const current = getApiOrigin();
  const host = current.replace(/^https?:\/\//, '');
  if (isDefaultOrigin() && current && !__DEV__) return null;

  const save = async () => {
    const origin = normalizeOrigin(value);
    if (!origin) {
      setError('Enter the address of your Enbox server, e.g. https://chat.example.com');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const prev = getApiOrigin();
      setApiOrigin(origin);
      try {
        await api.get('/api/health', { auth: false, timeoutMs: 15_000 });
      } catch (e) {
        setApiOrigin(prev);
        throw e;
      }
      toast.success(`Connected to ${origin.replace(/^https?:\/\//, '')}`);
      setOpen(false);
    } catch {
      setError('Couldn’t reach an Enbox server at that address.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Press
        onPress={() => {
          setValue(getApiOrigin());
          setError(null);
          setOpen(true);
        }}
        style={tw`mt-4 flex-row items-center gap-1.5 rounded-full px-3 py-1.5`}
        accessibilityLabel="Change server"
      >
        <Icon icon={Server} size={14} color={c.subtle} />
        <T style={tw`text-[13px] text-subtle`}>{host ? `Server: ${host}` : 'Choose server'}</T>
      </Press>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Enbox server"
        description="The address of the Enbox server you use on the web."
        footer={
          <>
            <Button variant="ghost" onPress={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onPress={() => void save()} loading={busy}>
              Save
            </Button>
          </>
        }
      >
        <Input
          label="Server address"
          value={value}
          onChangeText={(v) => {
            setValue(v);
            setError(null);
          }}
          placeholder="https://chat.example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          error={error}
          hint="Use http:// for a server on your local network."
        />
      </Modal>
    </>
  );
}
