/** /login — username or phone + password (web features/auth/LoginPage). */
import { useState } from 'react';
import { View } from 'react-native';
import { Link } from 'expo-router';
import { loginSchema, parseLoginIdentifier } from '@enbox/shared';
import { Button, Input, T } from '@/components/ui';
import { AuthLayout, FormError, PasswordInput, ServerLink } from '@/features/auth/AuthUi';
import { ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { validate } from '@/lib/forms';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme';

export default function LoginScreen() {
  const { tw } = useTheme();
  const login = useAuth((s) => s.login);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setFormError(null);
    const errs = {};
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

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to continue to Enbox."
      footer={
        <>
          <T style={tw`text-center text-[14px] text-muted`}>
            New to Enbox?{' '}
            <Link href="/register" replace>
              <T style={tw`text-[14px] font-semibold text-brand-ink`}>Create an account</T>
            </Link>
          </T>
          <ServerLink forceOpen />
        </>
      }
    >
      <View style={tw`gap-4`}>
        <Input
          label="Username or phone"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="username or +1 555 123 4567"
          value={identifier}
          onChangeText={setIdentifier}
          error={errors.identifier}
          returnKeyType="next"
        />
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
        />
        <FormError>{formError}</FormError>
        <Button size="lg" fullWidth loading={busy} onPress={() => void onSubmit()} style={tw`mt-2`}>
          Log in
        </Button>
      </View>
    </AuthLayout>
  );
}
