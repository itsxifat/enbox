/**
 * /register — display name, username (live format + availability check), password (strength
 * meter), optional phone (web features/auth/RegisterPage). On success the app continues to
 * /welcome (profile photo + about).
 */
import { useState } from 'react';
import { View } from 'react-native';
import { Link } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';
import { DISPLAY_NAME_MAX_LENGTH, PASSWORD_MIN_LENGTH, registerSchema } from '@enbox/shared';
import { Icon } from '@/components/icons';
import { Button, Input, Spinner, T } from '@/components/ui';
import {
  AuthLayout,
  FormError,
  PasswordInput,
  PasswordStrengthMeter,
  ServerLink,
} from '@/features/auth/AuthUi';
import { useOnboarding } from '@/features/auth/onboarding';
import { useUsernameAvailability } from '@/features/auth/usernameAvailability';
import { canonicalPhone, normalizeUsernameInput } from '@/features/auth/validation';
import { ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { validate } from '@/lib/forms';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme';

export default function RegisterScreen() {
  const { tw, c } = useTheme();
  const register = useAuth((s) => s.register);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState([]);

  const availability = useUsernameAvailability(username, { delayMs: 300 });
  const liveUsernameIssue =
    availability.state === 'invalid'
      ? availability.message
      : availability.state === 'taken'
        ? 'This username is taken'
        : null;
  const usernameError =
    errors.username ??
    (taken.includes(username) ? 'This username is taken' : null) ??
    liveUsernameIssue ??
    undefined;
  const usernameOk = !usernameError && availability.state === 'available';
  const checking = !usernameError && availability.state === 'checking';
  const phoneError =
    errors.phone ??
    (phoneTouched && phone.trim() && !canonicalPhone(phone)
      ? 'Enter a valid phone number with country code'
      : undefined);

  const clearError = (key) =>
    setErrors((e) => {
      if (!(key in e)) return e;
      const copy = { ...e };
      delete copy[key];
      return copy;
    });

  const onSubmit = async () => {
    setFormError(null);
    const values = { displayName, username, password, ...(phone.trim() ? { phone } : {}) };
    const r = validate(registerSchema, values);
    const errs = r.ok ? {} : { ...r.errors };
    if (!displayName.trim()) errs.displayName = 'Enter your name';
    if (!username.trim()) errs.username = 'Choose a username';
    if (taken.includes(username) || availability.state === 'taken')
      errs.username = 'This username is taken';
    if (!password) errs.password = 'Choose a password';
    if (!r.ok || Object.keys(errs).length) {
      setErrors(errs);
      setPhoneTouched(true);
      return;
    }
    setErrors({});
    setBusy(true);
    useOnboarding.setState({ pending: true });
    try {
      await register(r.data);
    } catch (err) {
      useOnboarding.setState({ pending: false });
      if (err instanceof ApiError && err.code === 'conflict') {
        if (/phone/i.test(err.message)) setErrors({ phone: err.message });
        else {
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

  return (
    <AuthLayout
      title="Create your account"
      subtitle="It only takes a minute."
      footer={
        <>
          <T style={tw`text-center text-[14px] text-muted`}>
            Already have an account?{' '}
            <Link href="/login" replace>
              <T style={tw`text-[14px] font-semibold text-brand-ink`}>Log in</T>
            </Link>
          </T>
          <ServerLink />
        </>
      }
    >
      <View style={tw`gap-4`}>
        <Input
          label="Your name"
          autoComplete="name"
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          placeholder="How friends will see you"
          value={displayName}
          onChangeText={(v) => {
            setDisplayName(v);
            clearError('displayName');
          }}
          error={errors.displayName}
        />
        <Input
          label="Username"
          prefix="@"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={32}
          value={username}
          onChangeText={(v) => {
            setUsername(normalizeUsernameInput(v));
            clearError('username');
          }}
          error={usernameError}
          rightSlot={
            usernameOk ? (
              <View style={tw`mr-2.5`}>
                <Icon icon={CircleCheck} size={18} color={c.success} />
              </View>
            ) : checking ? (
              <View style={tw`mr-2.5`}>
                <Spinner size={16} color={c.muted} />
              </View>
            ) : undefined
          }
          hint={
            usernameOk ? (
              <T style={tw`text-[13px] text-success`}>{availability.message}</T>
            ) : (
              '3–32 lowercase letters, numbers, dots or underscores. People can find you by it.'
            )
          }
        />
        <View style={tw`gap-2`}>
          <PasswordInput
            label="Password"
            autoComplete="new-password"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              clearError('password');
            }}
            error={errors.password}
            hint={password ? undefined : `At least ${PASSWORD_MIN_LENGTH} characters.`}
          />
          <PasswordStrengthMeter password={password} />
        </View>
        <Input
          label="Phone number"
          aside="Optional"
          autoComplete="tel"
          keyboardType="phone-pad"
          placeholder="+1 555 123 4567"
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            clearError('phone');
          }}
          onBlur={() => setPhoneTouched(true)}
          error={phoneError}
          hint="Include your country code. Lets people who have your number find you."
        />
        <FormError>{formError}</FormError>
        <Button size="lg" fullWidth loading={busy} onPress={() => void onSubmit()} style={tw`mt-2`}>
          Create account
        </Button>
        <T style={[tw`text-center text-[12px] text-subtle`, { lineHeight: 19.5 }]}>
          By creating an account you agree to use Enbox kindly and lawfully.
        </T>
      </View>
    </AuthLayout>
  );
}
