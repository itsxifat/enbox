import { useState } from 'react';
import { ListChecks, ShieldCheck, ShieldOff, ShieldPlus } from 'lucide-react';
import { useMe } from '@/stores/auth';
import { SettingsRow } from '../ui';
import { RemoveAuthenticatorModal, ViewBackupCodesModal } from './TwoFactorDialogs';
import { TWO_FACTOR_PATH } from './twoFactorApi';

/**
 * My Account ▸ Password and Authentication, the authenticator app rows. Off: "Enable
 * Authenticator App" (the setup wizard, or `onEnable` where the wizard is this page). On: the
 * status, "View Backup Codes" (password → a new set) and "Remove Authenticator App" (a code).
 */
export function TwoFactorRows({ onEnable }: { onEnable?: () => void }) {
  const me = useMe();
  const [dialog, setDialog] = useState<'codes' | 'remove' | null>(null);
  if (!me) return null;
  const close = () => setDialog(null);

  return (
    <>
      {me.mfaEnabled ? (
        <>
          <SettingsRow
            icon={ShieldCheck}
            title="Authenticator app enabled"
            description="Logging in asks for your password and a code from your authenticator app"
            end={
              <span className="shrink-0 rounded-full bg-success-soft px-2.5 py-0.5 text-[12px] font-semibold text-success">
                On
              </span>
            }
            testId="mfa-status-row"
          />
          <SettingsRow
            icon={ListChecks}
            title="View Backup Codes"
            description="One-time codes for when you can't use your authenticator app"
            onClick={() => setDialog('codes')}
          />
          <SettingsRow
            icon={ShieldOff}
            title="Remove Authenticator App"
            danger
            onClick={() => setDialog('remove')}
          />
        </>
      ) : (
        <SettingsRow
          icon={ShieldPlus}
          title="Enable Authenticator App"
          description="Protect your account with a code from an app on your phone each time you log in"
          to={onEnable ? undefined : TWO_FACTOR_PATH}
          onClick={onEnable}
        />
      )}
      <ViewBackupCodesModal open={dialog === 'codes' && !!me.mfaEnabled} onClose={close} />
      <RemoveAuthenticatorModal open={dialog === 'remove' && !!me.mfaEnabled} onClose={close} />
    </>
  );
}
