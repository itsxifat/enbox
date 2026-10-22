/**
 * The identity fields that are not part of the profile draft: username, phone, the one-line
 * status ("About") and the share link. Each saves on its own (its dialog has a Save button).
 * Settings → Account links here for username and phone.
 */
import { useState } from 'react';
import { AtSign, Check, Copy, Info, Link2, Share2 } from 'lucide-react';
import type { UserSelf } from '@enbox/shared';
import { PhoneIcon } from '@/components/icons';
import { Button, IconButton, Spinner, toast } from '@/components/ui';
import { useUsernameAvailability } from '@/features/auth/usernameAvailability';
import { canonicalPhone, normalizeUsernameInput, usernameIssue } from '@/features/auth/validation';
import { cn } from '@/lib/cn';
import { EditFieldModal } from '../EditFieldModal';
import { updateProfile } from '../settingsApi';
import { SettingsRow } from '../ui';
import { FormSection } from './FormSection';

/** Public share link for my profile (`/u/<username>`, opened by features/contacts). */
export function profileLink(username: string): string {
  return `${window.location.origin}/u/${username}`;
}

type Editing = 'username' | 'phone' | null;

export function AccountSection({ me }: { me: UserSelf }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [copied, setCopied] = useState(false);
  const link = profileLink(me.username);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy the link");
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: `${me.displayName} on Enbox`, url: link });
    } catch {
      /* dismissed */
    }
  };

  return (
    <FormSection
      title="Account and sharing"
      hint="These save right away. Anyone with your link can open your profile and start a chat with you; what they see follows your privacy settings."
    >
      <div className="card-inset flex flex-col p-1">
        <SettingsRow
          icon={AtSign}
          title="Username"
          description={`@${me.username}`}
          onClick={() => setEditing('username')}
          testId="profile-username"
        />
        <SettingsRow
          icon={PhoneIcon}
          title="Phone"
          description={me.phone ?? 'Not added'}
          onClick={() => setEditing('phone')}
          testId="profile-phone"
        />
        <SettingsRow
          icon={Info}
          title="About"
          description={me.about || 'Add a few words about yourself'}
          to="/settings/profile/about"
          testId="profile-about"
        />
        <SettingsRow
          icon={Link2}
          title={<span className="break-all">{link.replace(/^https?:\/\//, '')}</span>}
          chevron={false}
          end={
            <div className="flex shrink-0 items-center gap-1">
              {canShare ? (
                <IconButton icon={Share2} label="Share link" onClick={() => void share()} />
              ) : null}
              <IconButton
                icon={copied ? Check : Copy}
                label="Copy link"
                onClick={() => void copy()}
              />
            </div>
          }
        />
      </div>

      <EditFieldModal
        open={editing === 'username'}
        onClose={() => setEditing(null)}
        title="Edit username"
        label="Username"
        prefix="@"
        initialValue={me.username}
        maxLength={32}
        transform={normalizeUsernameInput}
        validate={(v) => usernameIssue(v) ?? (v ? null : 'Choose a username')}
        status={(v) => <UsernameStatus value={v} current={me.username} />}
        onSave={async (v) => {
          await updateProfile({ username: v });
          toast.success('Username updated');
        }}
      />
      <EditFieldModal
        open={editing === 'phone'}
        onClose={() => setEditing(null)}
        title={me.phone ? 'Change phone number' : 'Add phone number'}
        label="Phone number"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+1 555 123 4567"
        initialValue={me.phone ?? ''}
        validate={(v) =>
          !v.trim() || canonicalPhone(v) ? null : 'Enter a valid phone number with country code'
        }
        hint="Include your country code. Only contacts who saved your number can see it."
        onSave={async (v) => {
          await updateProfile({ phone: v.trim() ? canonicalPhone(v) : null });
          toast.success(v.trim() ? 'Phone number saved' : 'Phone number removed');
        }}
        extraAction={
          me.phone ? (
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => {
                void updateProfile({ phone: null })
                  .then(() => {
                    toast.success('Phone number removed');
                    setEditing(null);
                  })
                  .catch((e: unknown) => toast.error(e));
              }}
            >
              Remove
            </Button>
          ) : null
        }
      />
    </FormSection>
  );
}

/** Live availability (GET /api/auth/username-available, same check as registration). */
function UsernameStatus({ value, current }: { value: string; current: string }) {
  const { state, message } = useUsernameAvailability(value, { current });
  if (state === 'checking')
    return (
      <span className="inline-flex items-center gap-1.5">
        <Spinner size={12} label={null} /> Checking availability…
      </span>
    );
  if (!message) return <>Lowercase letters, numbers, dots or underscores.</>;
  return (
    <span
      className={cn(
        state === 'available' && 'text-success',
        (state === 'taken' || state === 'invalid') && 'text-danger',
      )}
      data-testid="username-availability"
    >
      {message}
    </span>
  );
}
