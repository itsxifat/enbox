import { useState } from 'react';
import { AtSign, Check, CircleUserRound, Copy, Info, Link2, Share2 } from 'lucide-react';
import { DISPLAY_NAME_MAX_LENGTH } from '@enbox/shared';
import { PhoneIcon } from '@/components/icons';
import { Button, IconButton, Spinner, toast } from '@/components/ui';
import { useUsernameAvailability } from '@/features/auth/usernameAvailability';
import { canonicalPhone, normalizeUsernameInput, usernameIssue } from '@/features/auth/validation';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { EditFieldModal } from '../EditFieldModal';
import { updateProfile } from '../settingsApi';
import { SettingsGroup, SettingsRow, SettingsScroller } from '../ui';
import { AvatarEditor } from './AvatarEditor';

/** Public share link for my profile (`/u/<username>`, opened by features/contacts). */
export function profileLink(username: string): string {
  return `${window.location.origin}/u/${username}`;
}

type Editing = 'name' | 'username' | 'phone' | null;

/** Settings → Profile: photo, name, about, username, phone, share link. */
export function ProfilePage() {
  const me = useMe();
  const [editing, setEditing] = useState<Editing>(null);
  const [copied, setCopied] = useState(false);
  if (!me) return null;
  const link = profileLink(me.username);

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
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <SettingsScroller>
      <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-6 lg:pt-2 lg:pb-0">
        <AvatarEditor size={160} />
        <div className="mt-2 text-center">
          <p className="text-[22px] font-semibold text-fg">{me.displayName}</p>
          <p className="text-[14px] text-muted">@{me.username}</p>
        </div>
      </div>

      <SettingsGroup>
        <SettingsRow
          icon={CircleUserRound}
          title="Name"
          description={me.displayName}
          onClick={() => setEditing('name')}
          testId="profile-name"
        />
        <SettingsRow
          icon={Info}
          title="About"
          description={me.about || 'Add a few words about yourself'}
          to="/settings/profile/about"
          testId="profile-about"
        />
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
      </SettingsGroup>

      <SettingsGroup
        title="Share your profile"
        footer="Anyone with this link can open your profile and start a chat with you on Enbox. What they see follows your privacy settings."
      >
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
      </SettingsGroup>

      <EditFieldModal
        open={editing === 'name'}
        onClose={() => setEditing(null)}
        title="Edit name"
        label="Your name"
        initialValue={me.displayName}
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        autoComplete="name"
        validate={(v) => (v.trim() ? null : "Name can't be empty")}
        onSave={async (v) => {
          await updateProfile({ displayName: v.trim() });
          toast.success('Name updated');
        }}
        hint="This is how you appear to people who haven't saved you as a contact."
      />
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
    </SettingsScroller>
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
