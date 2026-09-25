import { useState, type FormEvent } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button, Checkbox, confirm, toast } from '@/components/ui';
import { PasswordInput } from '@/features/auth/PasswordInput';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth, useMe } from '@/stores/auth';
import { SettingsScroller } from '../ui';

const CONSEQUENCES = [
  'Your profile, photo, about and phone number are erased',
  'You leave every group, community and channel you are in (group ownership passes to an admin)',
  'Channels you own pass to an admin, or are deleted when there is none',
  'Your contacts, blocked list and status updates are deleted',
  'You are logged out of every device',
  'Messages you already sent stay visible to others as "Deleted account"',
];

/** Settings → Account → Delete account (password + explicit acknowledgement). */
export function DeleteAccountPage() {
  const me = useMe();
  const [password, setPassword] = useState('');
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Enter your password to confirm');
      return;
    }
    const ok = await confirm({
      title: 'Delete your account permanently?',
      message: "This can't be undone.",
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete('/api/me', { password });
      await useAuth.getState().logout({ remote: false });
      toast.info('Your account was deleted');
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'forbidden')
        setError(err.message || 'Incorrect password');
      else setError(errorMessage(err));
    }
  };

  return (
    <SettingsScroller>
      <div className="flex flex-col gap-5 px-4 pt-6 lg:rounded-2xl lg:border lg:border-line lg:bg-surface lg:p-6">
        <div className="flex items-start gap-4 rounded-2xl bg-danger-soft p-4 text-danger">
          <TriangleAlert size={24} className="mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="text-[16px] font-semibold">Deleting your account will:</p>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-snug">
              {CONSEQUENCES.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
        <form
          onSubmit={submit}
          noValidate
          className="flex flex-col gap-4"
          aria-label="Delete account"
        >
          <input
            type="text"
            autoComplete="username"
            value={me?.username ?? ''}
            className="hidden"
            readOnly
            aria-hidden
          />
          <PasswordInput
            label="Confirm with your password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            error={error ?? undefined}
          />
          <Checkbox checked={ack} onChange={setAck} label="I understand this can't be undone" />
          <Button
            type="submit"
            variant="danger"
            loading={busy}
            disabled={!ack}
            className="mt-1 self-start"
          >
            Delete my account
          </Button>
        </form>
      </div>
    </SettingsScroller>
  );
}
