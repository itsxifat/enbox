import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AlertCircle, CircleCheck } from 'lucide-react';
import { DISPLAY_NAME_MAX_LENGTH, PASSWORD_MIN_LENGTH, registerSchema } from '@enbox/shared';
import { safeNext } from '@/app/guards';
import { Button, Input } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/forms';
import { useAuth } from '@/stores/auth';
import { AuthLayout } from './AuthLayout';
import { PasswordInput } from './PasswordInput';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';
import { canonicalPhone, normalizeUsernameInput, usernameIssue } from './validation';

/** Where to land after registering: the welcome/onboarding page, then `next`. */
export function welcomePath(next: string | null): string {
  const target = safeNext(next, '');
  return target ? `/welcome?next=${encodeURIComponent(target)}` : '/welcome';
}

/**
 * /register — display name, username (live format check), password (strength meter),
 * optional phone. On success <PublicOnly/> redirects to `/welcome` (profile photo + about),
 * which then continues to the original `?next=`.
 */
export function RegisterPage() {
  const register = useAuth((s) => s.register);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Usernames the server told us are taken (instant feedback when typed again). */
  const [taken, setTaken] = useState<string[]>([]);

  const debouncedUsername = useDebouncedValue(username, 300);
  const liveUsernameIssue =
    debouncedUsername === username && username ? usernameIssue(username) : null;
  const usernameError =
    errors.username ??
    (taken.includes(username) ? 'This username is taken' : null) ??
    liveUsernameIssue ??
    undefined;
  const usernameOk = !!username && !usernameError && debouncedUsername === username;
  const phoneError =
    errors.phone ??
    (phoneTouched && phone.trim() && !canonicalPhone(phone)
      ? 'Enter a valid phone number with country code'
      : undefined);

  const next = params.get('next');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const values = { displayName, username, password, ...(phone.trim() ? { phone } : {}) };
    const r = validate(registerSchema, values);
    const errs: FieldErrors = r.ok ? {} : { ...r.errors };
    if (!displayName.trim()) errs.displayName = 'Enter your name';
    if (!username.trim()) errs.username = 'Choose a username';
    if (taken.includes(username)) errs.username = 'This username is taken';
    if (!password) errs.password = 'Choose a password';
    if (!r.ok || Object.keys(errs).length) {
      setErrors(errs);
      setPhoneTouched(true);
      return;
    }
    setErrors({});
    setBusy(true);
    // <PublicOnly/> redirects to `?next=` as soon as the session starts: point it at the
    // onboarding page (restored below if registration fails).
    await navigate({ search: `?next=${encodeURIComponent(welcomePath(next))}` }, { replace: true });
    try {
      await register(r.data);
    } catch (err) {
      await navigate(
        { search: next ? `?next=${encodeURIComponent(next)}` : '' },
        { replace: true },
      );
      if (err instanceof ApiError && err.code === 'conflict') {
        if (/phone/i.test(err.message)) {
          setErrors({ phone: err.message });
        } else {
          setTaken((t) => [...t, r.data.username]);
          setErrors({ username: err.message || 'This username is taken' });
        }
      } else if (
        err instanceof ApiError &&
        err.code === 'validation_error' &&
        Object.keys(fieldErrors(err)).length
      ) {
        setErrors(fieldErrors(err));
      } else {
        setFormError(errorMessage(err));
      }
      setBusy(false);
    }
  };

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  const clearError = (key: string) =>
    setErrors((e) => {
      if (!(key in e)) return e;
      const copy = { ...e };
      delete copy[key];
      return copy;
    });

  return (
    <AuthLayout
      title="Create your account"
      subtitle="It only takes a minute."
      footer={
        <>
          Already have an account?{' '}
          <Link to={loginHref} className="font-semibold text-brand-ink hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-4"
        aria-label="Create account"
      >
        <Input
          label="Your name"
          name="displayName"
          autoComplete="name"
          autoFocus
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          placeholder="How friends will see you"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            clearError('displayName');
          }}
          error={errors.displayName}
        />
        <Input
          label="Username"
          name="username"
          prefix="@"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={32}
          value={username}
          onChange={(e) => {
            setUsername(normalizeUsernameInput(e.target.value));
            clearError('username');
          }}
          error={usernameError}
          rightSlot={
            usernameOk ? (
              <CircleCheck size={18} className="mr-2.5 text-success" aria-label="Valid username" />
            ) : undefined
          }
          hint="3–32 lowercase letters, numbers, dots or underscores. People can find you by it."
        />
        <div className="flex flex-col gap-2">
          <PasswordInput
            label="Password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError('password');
            }}
            error={errors.password}
            hint={password ? undefined : `At least ${PASSWORD_MIN_LENGTH} characters.`}
          />
          <PasswordStrengthMeter password={password} />
        </div>
        <Input
          label="Phone number"
          aside="Optional"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+1 555 123 4567"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            clearError('phone');
          }}
          onBlur={() => setPhoneTouched(true)}
          error={phoneError}
          hint="Include your country code. Lets people who have your number find you."
        />
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
          Create account
        </Button>
        <p className="text-center text-[12px] leading-relaxed text-subtle">
          By creating an account you agree to use Enbox kindly and lawfully.
        </p>
      </form>
    </AuthLayout>
  );
}
