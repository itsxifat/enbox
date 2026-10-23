import { useEffect, useState, type FormEvent } from 'react';
import { TriangleAlert } from 'lucide-react';
import { disableTotpSchema } from '@enbox/shared';
import { Button, Input, Modal, toast } from '@/components/ui';
import { PasswordInput } from '@/features/auth/PasswordInput';
import { ApiError, errorMessage } from '@/lib/api';
import { useMe } from '@/stores/auth';
import { BackupCodesList } from './BackupCodesList';
import { disableTotp, regenerateBackupCodes } from './twoFactorApi';

/**
 * "View Backup Codes": the codes are stored hashed, so viewing them means a new set — my
 * password first, with the warning that the old ones stop working, then the new codes.
 */
export function ViewBackupCodesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  // Every opening starts over (the codes are never kept around).
  useEffect(() => {
    if (!open) return;
    setPassword('');
    setError(null);
    setCodes(null);
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Enter your password');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setCodes(await regenerateBackupCodes(password));
      setPassword('');
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'forbidden'
          ? err.message || 'Your password is incorrect'
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={codes ? 'Your new backup codes' : 'View Backup Codes'}
      description={
        codes
          ? 'Each code logs you in once. Keep them somewhere safe: they won’t be shown again.'
          : 'Backup codes are stored securely, so they can’t be shown again. Enter your password to generate a new set.'
      }
    >
      {codes ? (
        <div className="pb-3">
          <BackupCodesList
            codes={codes}
            username={me?.username ?? ''}
            onDone={onClose}
            doneLabel="Done"
          />
        </div>
      ) : (
        <form
          onSubmit={submit}
          noValidate
          className="flex flex-col gap-4 pb-3"
          aria-label="Generate new backup codes"
        >
          <p className="flex items-start gap-2.5 rounded-xl bg-warning-soft px-3.5 py-2.5 text-[14px] text-warning-ink">
            <TriangleAlert size={18} className="mt-px shrink-0" aria-hidden />
            Generating new codes makes the old ones stop working.
          </p>
          {/* Helps password managers pair the password with the account. */}
          <input
            type="text"
            autoComplete="username"
            value={me?.username ?? ''}
            className="hidden"
            readOnly
            aria-hidden
          />
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            error={error ?? undefined}
          />
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Generate New Codes
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** "Remove Authenticator App": a code from the app or an unused backup code turns it off. */
export function RemoveAuthenticatorModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode('');
    setError(null);
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = disableTotpSchema.safeParse({ code });
    if (!parsed.success) {
      setError('Enter a 6-digit code or a backup code');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await disableTotp(parsed.data.code);
      onClose();
      toast.success('Authenticator app removed', {
        description: 'Logging in now only needs your password.',
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_code') {
        setError(err.message || 'Invalid two-factor code');
      } else if (err instanceof ApiError && err.code === 'conflict') {
        // Already off (another device).
        onClose();
        toast.info(err.message);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Remove Authenticator App"
      description="Enter a 6-digit code from your authenticator app, or one of your backup codes, to turn off two-factor authentication."
    >
      <form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4 pb-3"
        aria-label="Remove authenticator app"
      >
        <Input
          label="Authentication or backup code"
          name="code"
          autoComplete="one-time-code"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={12}
          autoFocus
          placeholder="6-digit code or xxxx-xxxx"
          className="font-mono tracking-wide"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          error={error ?? undefined}
        />
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={busy}>
            Remove
          </Button>
        </div>
      </form>
    </Modal>
  );
}
