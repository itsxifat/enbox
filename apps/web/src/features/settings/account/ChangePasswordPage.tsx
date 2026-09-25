import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { KeyRound } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, changePasswordSchema } from '@enbox/shared';
import { Button, toast } from '@/components/ui';
import { PasswordInput } from '@/features/auth/PasswordInput';
import { PasswordStrengthMeter } from '@/features/auth/PasswordStrengthMeter';
import { ApiError, api, errorMessage, fieldErrors } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/forms';
import { useMe } from '@/stores/auth';
import { SettingsHero, SettingsScroller } from '../ui';

/** Settings → Account → Change password (revokes every other session). */
export function ChangePasswordPage() {
  const navigate = useNavigate();
  const me = useMe();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = validate(changePasswordSchema, { currentPassword, newPassword });
    const errs: FieldErrors = r.ok ? {} : { ...r.errors };
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
      void navigate('/settings/account', { replace: true });
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
      <form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4 px-4 lg:rounded-2xl lg:border lg:border-line lg:bg-surface lg:p-6"
        aria-label="Change password"
      >
        {/* Helps password managers pair the new password with the account. */}
        <input
          type="text"
          autoComplete="username"
          value={me?.username ?? ''}
          className="hidden"
          readOnly
          aria-hidden
        />
        <PasswordInput
          label="Current password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
          error={errors.currentPassword}
        />
        <div className="flex flex-col gap-2">
          <PasswordInput
            label="New password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            error={errors.newPassword}
          />
          <PasswordStrengthMeter password={newPassword} />
        </div>
        <PasswordInput
          label="Confirm new password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        <Button type="submit" loading={busy} className="mt-2 self-end" size="md">
          Change password
        </Button>
      </form>
    </SettingsScroller>
  );
}
