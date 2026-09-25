import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertCircle } from 'lucide-react';
import { loginSchema, parseLoginIdentifier } from '@enbox/shared';
import { Button, Input } from '@/components/ui';
import { ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/forms';
import { useAuth } from '@/stores/auth';
import { AuthLayout } from './AuthLayout';
import { PasswordInput } from './PasswordInput';

/** /login — username or phone + password. Redirects to `?next=` via <PublicOnly/>. */
export function LoginPage() {
  const login = useAuth((s) => s.login);
  const [params] = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errs: FieldErrors = {};
    if (!identifier.trim()) errs.identifier = 'Enter your username or phone number';
    else if (!parseLoginIdentifier(identifier))
      errs.identifier = 'Enter a valid phone number with country code, e.g. +1 555 123 4567';
    if (!password) errs.password = 'Enter your password';
    const r = validate(loginSchema, { identifier, password });
    if (Object.keys(errs).length || !r.ok) {
      setErrors({ ...(r.ok ? {} : r.errors), ...errs });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await login(r.data);
      // <PublicOnly/> redirects to `next` once the store is authenticated.
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setFormError(err.message || 'Incorrect username, phone number or password.');
      } else if (err instanceof ApiError && err.code === 'validation_error') {
        const fe = fieldErrors(err);
        setErrors(fe);
        setFormError(Object.keys(fe).length ? null : err.message);
      } else {
        setFormError(errorMessage(err));
      }
      setBusy(false);
    }
  };

  const next = params.get('next');
  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : '/register';

  return (
    <AuthLayout
      title="Welcome back"
      subtitle={
        next?.startsWith('/join/')
          ? 'Log in to join the conversation you were invited to.'
          : 'Log in to continue to Enbox.'
      }
      footer={
        <>
          New to Enbox?{' '}
          <Link to={registerHref} className="font-semibold text-brand-ink hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-label="Log in">
        <Input
          label="Username or phone"
          name="identifier"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          placeholder="username or +1 555 123 4567"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          error={errors.identifier}
        />
        <PasswordInput
          label="Password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
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
          Log in
        </Button>
      </form>
    </AuthLayout>
  );
}
