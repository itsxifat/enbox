import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { BellRing, Check } from 'lucide-react';
import {
  ABOUT_MAX_LENGTH,
  DEFAULT_ABOUT,
  DISPLAY_NAME_MAX_LENGTH,
  type UpdateProfileRequest,
} from '@enbox/shared';
import { safeNext } from '@/app/guards';
import { Button, Input, toast } from '@/components/ui';
import { AvatarEditor } from '@/features/settings/profile/AvatarEditor';
import { ABOUT_PRESETS, updateProfile } from '@/features/settings/settingsApi';
import { cn } from '@/lib/cn';
import { notificationPermission, requestNotificationPermission } from '@/lib/notify';
import { enablePush, pushSupported } from '@/lib/push';
import { useMe } from '@/stores/auth';
import { AuthLayout } from './AuthLayout';

const QUICK_ABOUT = [DEFAULT_ABOUT, ...ABOUT_PRESETS.slice(0, 4)];

/**
 * /welcome — optional onboarding right after registering: profile photo, name, about and
 * notifications. "Continue"/"Skip" go to `?next=` (default /chats).
 */
export function WelcomePage() {
  const me = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [name, setName] = useState(me?.displayName ?? '');
  const [about, setAbout] = useState(me?.about ?? DEFAULT_ABOUT);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState(() => notificationPermission());
  const [enabling, setEnabling] = useState(false);
  if (!me) return null;

  const done = () => void navigate(next, { replace: true });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Enter your name');
      return;
    }
    const patch: UpdateProfileRequest = {};
    if (name.trim() !== me.displayName) patch.displayName = name.trim();
    if (about.trim() !== me.about) patch.about = about.trim();
    if (Object.keys(patch).length) {
      setBusy(true);
      try {
        await updateProfile(patch);
      } catch (err) {
        toast.error(err);
        setBusy(false);
        return;
      }
    }
    toast.success(`Welcome to Enbox, ${name.trim().split(/\s+/)[0]}!`);
    done();
  };

  const turnOnNotifications = async () => {
    setEnabling(true);
    try {
      if (pushSupported()) await enablePush();
      else await requestNotificationPermission();
    } finally {
      setPermission(notificationPermission());
      setEnabling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-surface" data-testid="welcome-page">
      <AuthLayout
        title="Set up your profile"
        subtitle="Add a photo and a few words so friends know it’s you. You can change these any time in Settings."
      >
        <form
          onSubmit={submit}
          noValidate
          className="flex flex-col gap-5"
          aria-label="Profile setup"
        >
          <div className="flex justify-center py-2">
            <AvatarEditor size={128} />
          </div>
          <Input
            label="Your name"
            value={name}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            autoComplete="name"
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            error={nameError ?? undefined}
          />
          <div className="flex flex-col gap-2">
            <Input
              label="About"
              aside={`${ABOUT_MAX_LENGTH - Array.from(about).length}`}
              value={about}
              maxLength={ABOUT_MAX_LENGTH}
              onChange={(e) => setAbout(e.target.value)}
            />
            <div className="flex flex-wrap gap-2" aria-label="About suggestions">
              {QUICK_ABOUT.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAbout(p)}
                  aria-pressed={about === p}
                  className={cn(
                    'h-8 rounded-full px-3 text-[13px] font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-brand',
                    about === p
                      ? 'bg-brand-soft text-brand-ink'
                      : 'bg-surface-2 text-muted hover:bg-line hover:text-fg',
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {permission === 'default' || permission === 'granted' ? (
            <div className="flex items-center gap-3 rounded-2xl border border-line p-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
                <BellRing size={20} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-fg">Notifications</p>
                <p className="text-[13px] text-muted">
                  {permission === 'granted'
                    ? 'You’ll be notified about new messages and calls.'
                    : 'Get notified about new messages and calls.'}
                </p>
              </div>
              {permission === 'granted' ? (
                <Check size={20} className="text-success" aria-label="Enabled" />
              ) : (
                <Button
                  size="sm"
                  variant="soft"
                  loading={enabling}
                  onClick={() => void turnOnNotifications()}
                >
                  Turn on
                </Button>
              )}
            </div>
          ) : null}

          <div className="mt-1 flex flex-col gap-2">
            <Button type="submit" size="lg" fullWidth loading={busy}>
              Continue
            </Button>
            <Button variant="ghost" fullWidth onClick={done} disabled={busy}>
              Skip for now
            </Button>
          </div>
        </form>
      </AuthLayout>
    </div>
  );
}
