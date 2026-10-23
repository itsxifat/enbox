import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle } from 'lucide-react';
import { backupCodeSchema, totpCodeSchema, type MfaChallenge } from '@enbox/shared';
import { Button, Input } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { AuthLayout } from './AuthLayout';

type Mode = 'app' | 'backup';

const TIMED_OUT = 'Your login timed out. Log in again.';

const linkButton =
  'rounded font-semibold text-brand-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

/**
 * The login's second step when the account has two-factor on (`login()` answered an
 * `MfaChallenge`): the 6-digit code from the authenticator app, sent as soon as it is
 * complete, or a backup code. Success continues like any login (`loginMfa` → the session;
 * <PublicOnly/> redirects). An expired ticket goes back to the password step (`onExpired`).
 */
export function MfaStep({
  challenge,
  onBack,
  onExpired,
}: {
  challenge: MfaChallenge;
  /** "Go back to login". */
  onBack: () => void;
  /** The ticket is no longer valid (timed out, or the password changed meanwhile). */
  onExpired: (message: string) => void;
}) {
  const loginMfa = useAuth((s) => s.loginMfa);
  const [mode, setMode] = useState<Mode>('app');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Typing the 6th digit and pressing Enter must not send the code twice.
  const sending = useRef(false);

  // After a failed try the field is enabled again: focus it with the code selected, so typing
  // the next one replaces it.
  useEffect(() => {
    if (!error && !formError) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [error, formError]);

  const send = async (value: string) => {
    if (sending.current) return;
    const parsed = (mode === 'app' ? totpCodeSchema : backupCodeSchema).safeParse(value);
    if (!parsed.success) {
      setError(mode === 'app' ? 'Enter the 6-digit code' : 'Enter a backup code');
      return;
    }
    sending.current = true;
    setBusy(true);
    setError(null);
    setFormError(null);
    try {
      await loginMfa({ ticket: challenge.ticket, code: parsed.data });
    } catch (err) {
      sending.current = false;
      setBusy(false);
      if (err instanceof ApiError && err.status === 401) {
        onExpired(err.message || TIMED_OUT);
        return;
      }
      if (err instanceof ApiError && err.status === 400)
        setError((err.code === 'invalid_code' && err.message) || 'Invalid two-factor code');
      else setFormError(errorMessage(err));
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(code);
  };

  const switchMode = () => {
    setMode((m) => (m === 'app' ? 'backup' : 'app'));
    setCode('');
    setError(null);
    setFormError(null);
  };

  return (
    <AuthLayout
      title="Multi-Factor Authentication"
      subtitle={
        mode === 'app'
          ? 'Enter the 6-digit code from your authenticator app'
          : 'Enter one of the backup codes you saved when you turned on two-factor authentication'
      }
      footer={
        <button type="button" className={linkButton} onClick={onBack}>
          Go back to login
        </button>
      }
    >
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-4"
        aria-label="Two-factor authentication"
      >
        {mode === 'app' ? (
          <Input
            key="app"
            ref={inputRef}
            label="Authentication code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            autoFocus
            placeholder="6-digit code"
            className="font-mono text-[18px] tracking-[0.3em]"
            value={code}
            disabled={busy}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(digits);
              setError(null);
              if (digits.length === 6) void send(digits);
            }}
            error={error ?? undefined}
          />
        ) : (
          <Input
            key="backup"
            ref={inputRef}
            label="Backup code"
            name="backup-code"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={12}
            autoFocus
            placeholder="xxxx-xxxx"
            className="font-mono text-[18px] tracking-[0.1em]"
            value={code}
            disabled={busy}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            error={error ?? undefined}
          />
        )}
        {formError ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger"
          >
            <AlertCircle size={18} className="mt-px shrink-0" aria-hidden />
            {formError}
          </p>
        ) : null}
        <Button type="submit" size="lg" fullWidth loading={busy} className="mt-2">
          Log in
        </Button>
        <button
          type="button"
          className={cn('self-center text-[14px]', linkButton)}
          onClick={switchMode}
        >
          {mode === 'app' ? 'Use a backup code instead' : 'Use your authenticator app instead'}
        </button>
      </form>
    </AuthLayout>
  );
}
