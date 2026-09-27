/** Settings → Account, Change password, Delete account (web features/settings/account/*). */
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { KeyRound, Laptop, LogOut, Trash2, TriangleAlert, UserRoundCog } from 'lucide-react-native';
import { PASSWORD_MIN_LENGTH, changePasswordSchema } from '@enbox/shared';
import { Icon, PhoneIcon } from '@/components/icons';
import { Button, Checkbox, T, confirm, toast } from '@/components/ui';
import { PasswordInput, PasswordStrengthMeter } from '@/features/auth/AuthUi';
import { ApiError, api, errorMessage, fieldErrors } from '@/lib/api';
import { formatShortDate } from '@/lib/format';
import { validate } from '@/lib/forms';
import { useAuth, useMe } from '@/stores/auth';
import { useTheme } from '@/theme';
import { SettingsGroup, SettingsHero, SettingsNote, SettingsRow, SettingsScroller } from '../ui';

export async function confirmLogout() {
  const ok = await confirm({
    title: 'Log out of Enbox?',
    message: 'You can log back in any time with your username and password.',
    confirmLabel: 'Log out',
    danger: true,
  });
  if (ok) await useAuth.getState().logout();
}

export function AccountPage() {
  const me = useMe();
  if (!me) return null;
  return (
    <SettingsScroller>
      <SettingsGroup title="Security">
        <SettingsRow
          icon={KeyRound}
          title="Change password"
          description="Changing it logs out your other devices"
          to="/settings/account/password"
        />
        <SettingsRow
          icon={Laptop}
          title="Linked devices"
          description="See and manage where you're logged in"
          to="/settings/devices"
        />
      </SettingsGroup>
      <SettingsGroup title="Account info">
        <SettingsRow
          icon={UserRoundCog}
          title="Username"
          description={`@${me.username}`}
          to="/settings/profile"
        />
        <SettingsRow
          icon={PhoneIcon}
          title="Phone number"
          description={me.phone ?? 'Not added'}
          to="/settings/profile"
        />
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow icon={LogOut} title="Log out" onPress={() => void confirmLogout()} />
        <SettingsRow icon={Trash2} title="Delete account" danger to="/settings/account/delete" />
      </SettingsGroup>
      <SettingsNote>Member since {formatShortDate(me.createdAt)}.</SettingsNote>
    </SettingsScroller>
  );
}

export function ChangePasswordPage() {
  const { tw } = useTheme();
  const router = useRouter();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const r = validate(changePasswordSchema, { currentPassword, newPassword });
    const errs = r.ok ? {} : { ...r.errors };
    if (!currentPassword) errs.currentPassword = 'Enter your current password';
    if (newPassword && confirmPassword !== newPassword) errs.confirm = "Passwords don't match";
    if (newPassword && newPassword === currentPassword)
      errs.newPassword = 'Choose a password different from the current one';
    if (!r.ok || Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api.post('/api/auth/change-password', r.data);
      toast.success('Password changed', {
        description: 'Your other devices have been logged out.',
      });
      if (router.canGoBack()) router.back();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'forbidden') {
        setErrors({ currentPassword: err.message || 'Your current password is incorrect' });
      } else if (err instanceof ApiError && err.code === 'validation_error') {
        setErrors(fieldErrors(err));
      } else {
        toast.error(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsScroller>
      <SettingsHero icon={KeyRound} title="Change your password">
        Use at least {PASSWORD_MIN_LENGTH} characters. After the change, every other device linked
        to your account is logged out.
      </SettingsHero>
      <View style={tw`gap-4 px-4`}>
        <PasswordInput
          label="Current password"
          autoComplete="current-password"
          textContentType="password"
          value={currentPassword}
          onChangeText={setCurrent}
          error={errors.currentPassword}
        />
        <View style={tw`gap-2`}>
          <PasswordInput
            label="New password"
            autoComplete="new-password"
            textContentType="newPassword"
            value={newPassword}
            onChangeText={setNew}
            error={errors.newPassword}
          />
          <PasswordStrengthMeter password={newPassword} />
        </View>
        <PasswordInput
          label="Confirm new password"
          autoComplete="new-password"
          textContentType="newPassword"
          value={confirmPassword}
          onChangeText={setConfirm}
          error={errors.confirm}
          onSubmitEditing={() => void submit()}
        />
        <Button loading={busy} style={tw`mt-2 self-end`} onPress={() => void submit()}>
          Change password
        </Button>
      </View>
    </SettingsScroller>
  );
}

const CONSEQUENCES = [
  'Your profile, photo, about and phone number are erased',
  'You leave every group, community and channel you are in (group ownership passes to an admin)',
  'Channels you own pass to an admin, or are deleted when there is none',
  'Your contacts, blocked list and status updates are deleted',
  'You are logged out of every device',
  'Messages you already sent stay visible to others as "Deleted account"',
];

export function DeleteAccountPage() {
  const { tw, c } = useTheme();
  const [password, setPassword] = useState('');
  const [ack, setAck] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!password) {
      setError('Enter your password to confirm');
      return;
    }
    const ok = await confirm({
      title: 'Delete your account permanently?',
      message: "This can't be undone.",
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete('/api/me', { password });
      await useAuth.getState().logout({ remote: false });
      toast.info('Your account was deleted');
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'forbidden')
        setError(err.message || 'Incorrect password');
      else setError(errorMessage(err));
    }
  };

  return (
    <SettingsScroller>
      <View style={tw`gap-5 px-4 pt-6`}>
        <View style={tw`flex-row items-start gap-4 rounded-2xl bg-danger-soft p-4`}>
          <Icon icon={TriangleAlert} size={24} color={c.danger} style={tw`mt-0.5`} />
          <View style={tw`min-w-0 flex-1`}>
            <T style={tw`text-[16px] font-semibold text-danger`}>Deleting your account will:</T>
            <View style={tw`mt-2 gap-1.5`}>
              {CONSEQUENCES.map((line) => (
                <View key={line} style={tw`flex-row gap-2`}>
                  <T style={tw`text-[14px] text-danger`}>•</T>
                  <T style={tw`min-w-0 flex-1 text-[14px] leading-snug text-danger`}>{line}</T>
                </View>
              ))}
            </View>
          </View>
        </View>
        <View style={tw`gap-4`}>
          <PasswordInput
            label="Confirm with your password"
            autoComplete="current-password"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setError(null);
            }}
            error={error ?? undefined}
          />
          <Checkbox checked={ack} onChange={setAck} label="I understand this can't be undone" />
          <Button
            variant="danger"
            loading={busy}
            disabled={!ack}
            style={tw`mt-1 self-start`}
            onPress={() => void submit()}
          >
            Delete my account
          </Button>
        </View>
      </View>
    </SettingsScroller>
  );
}
