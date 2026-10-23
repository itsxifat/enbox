import { KeyRound, Laptop, LogOut, Trash2, UserRoundCog } from 'lucide-react';
import { PhoneIcon } from '@/components/icons';
import { confirm } from '@/components/ui';
import { formatShortDate } from '@/lib/format';
import { useAuth, useMe } from '@/stores/auth';
import { PERSONAL_HIDDEN_TEXT, useStreamerHides } from '@/stores/streamer';
import { SettingsGroup, SettingsNote, SettingsRow, SettingsScroller } from '../ui';
import { TwoFactorRows } from './TwoFactorRows';

export async function confirmLogout(): Promise<void> {
  const ok = await confirm({
    title: 'Log out of Enbox?',
    message: 'You can log back in any time with your username and password.',
    confirmLabel: 'Log out',
    danger: true,
  });
  if (ok) await useAuth.getState().logout();
}

/** Settings → Account: password, devices, two-factor, phone, log out, delete account. */
export function AccountPage() {
  const me = useMe();
  // Streamer Mode ▸ Hide Personal Information.
  const hide = useStreamerHides('personal');
  if (!me) return null;
  return (
    <SettingsScroller>
      <SettingsGroup title="Password and Authentication">
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
        <TwoFactorRows />
      </SettingsGroup>
      <SettingsGroup title="Account info">
        <SettingsRow
          icon={UserRoundCog}
          title="Username"
          description={hide ? PERSONAL_HIDDEN_TEXT : `@${me.username}`}
          to="/settings/profile"
        />
        <SettingsRow
          icon={PhoneIcon}
          title="Phone number"
          description={hide ? PERSONAL_HIDDEN_TEXT : (me.phone ?? 'Not added')}
          to="/settings/profile"
        />
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow icon={LogOut} title="Log out" onClick={() => void confirmLogout()} />
        <SettingsRow
          icon={Trash2}
          title="Delete account"
          danger
          to="/settings/account/delete"
          testId="delete-account-row"
        />
      </SettingsGroup>
      <SettingsNote>Member since {formatShortDate(me.createdAt)}.</SettingsNote>
    </SettingsScroller>
  );
}
