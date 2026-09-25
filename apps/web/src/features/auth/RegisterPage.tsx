import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PASSWORD_MIN_LENGTH, registerSchema } from '@enbox/shared';
import { Button, Input } from '@/components/ui';
import { ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/forms';
import { useAuth } from '@/stores/auth';
import { AuthLayout } from './AuthLayout';
import { PasswordInput } from './PasswordInput';

/** /register — display name, username, password, optional phone. */
export function RegisterPage() {
  const register = useAuth((s) => s.register);
  const [params] = useSearchParams();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const values = { displayName, username, password, ...(phone.trim() ? { phone } : {}) };
    const r = validate(registerSchema, values);
    const errs: FieldErrors = r.ok ? {} : { ...r.errors };
    if (!displayName.trim()) errs.displayName = 'Enter your name';
    if (!username.trim()) errs.username = 'Choose a username';
    if (!r.ok || Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await register(r.data);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') {
        setErrors({ username: err.message || 'That username is taken' });
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

  const next = params.get('next');
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';

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
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Input
          label="Your name"
          name="displayName"
          autoComplete="name"
          autoFocus
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
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
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
          error={errors.username}
          hint="Lowercase letters, numbers, dots and underscores."
        />
        <PasswordInput
          label="Password"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        <Input
          label="Phone number"
          aside="Optional"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+1 555 123 4567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={errors.phone}
          hint="Lets people who have your number find you."
        />
        {formError ? (
          <p
            role="alert"
            className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger"
          >
            {formError}
          </p>
        ) : null}
        <Button type="submit" size="lg" fullWidth loading={busy} className="mt-2">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
