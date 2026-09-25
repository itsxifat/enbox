/**
 * Status privacy (PATCH /api/me/settings): My contacts / My contacts except… / Only share
 * with…, with a contacts picker for the lists. Applies to statuses posted afterwards.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  userDisplayName,
  type Contact,
  type ID,
  type StatusPrivacy,
  type UserSettings,
} from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button, EmptyState, ListItemSkeleton, Modal, SearchInput, toast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuth, useMe } from '@/stores/auth';
import { SelectRow } from '@/features/calls/ui/SelectRow';

const OPTIONS: { value: StatusPrivacy; label: string; hint: string }[] = [
  { value: 'contacts', label: 'My contacts', hint: 'Everyone you saved as a contact' },
  {
    value: 'contacts_except',
    label: 'My contacts except…',
    hint: 'Hide your status from some contacts',
  },
  { value: 'only_share_with', label: 'Only share with…', hint: 'Only the contacts you pick' },
];

export function StatusPrivacyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const settings = me?.settings;
  const [privacy, setPrivacy] = useState<StatusPrivacy>(settings?.statusPrivacy ?? 'contacts');
  const [except, setExcept] = useState<ID[]>(settings?.statusExcludeUserIds ?? []);
  const [only, setOnly] = useState<ID[]>(settings?.statusOnlyShareWithUserIds ?? []);
  const [picking, setPicking] = useState<'contacts_except' | 'only_share_with' | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !settings) return;
    setPrivacy(settings.statusPrivacy);
    setExcept(settings.statusExcludeUserIds);
    setOnly(settings.statusOnlyShareWithUserIds);
    setPicking(null);
    // Reset from the saved settings each time the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.patch<UserSettings>('/api/me/settings', {
        statusPrivacy: privacy,
        statusExcludeUserIds: except,
        statusOnlyShareWithUserIds: only,
      });
      useAuth.getState().patchUser({ settings: next });
      toast.success('Status privacy updated');
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (picking) {
    return (
      <ContactsPicker
        open={open}
        title={picking === 'contacts_except' ? 'Hide status from…' : 'Share status with…'}
        initial={picking === 'contacts_except' ? except : only}
        onCancel={() => setPicking(null)}
        onDone={(ids) => {
          if (picking === 'contacts_except') setExcept(ids);
          else setOnly(ids);
          setPrivacy(picking);
          setPicking(null);
        }}
      />
    );
  }

  const count = (v: StatusPrivacy) =>
    v === 'contacts_except' ? except.length : v === 'only_share_with' ? only.length : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Status privacy"
      description="Who can see my status updates"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={privacy === 'only_share_with' && only.length === 0}
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <div
        role="radiogroup"
        aria-label="Who can see my status updates"
        className="-mx-2 flex flex-col"
      >
        {OPTIONS.map((o) => {
          const checked = privacy === o.value;
          const n = count(o.value);
          return (
            <div key={o.value} className="flex items-center rounded-2xl hover:bg-hover">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-2 py-2.5">
                <input
                  type="radio"
                  name="status-privacy"
                  className="peer sr-only"
                  checked={checked}
                  onChange={() => {
                    setPrivacy(o.value);
                    if (o.value !== 'contacts' && count(o.value) === 0) setPicking(o.value);
                  }}
                />
                <span
                  aria-hidden
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand',
                    checked ? 'border-brand' : 'border-line-strong',
                  )}
                >
                  {checked ? <span className="size-2.5 rounded-full bg-brand" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] text-fg">{o.label}</span>
                  <span className="block text-[13px] text-muted">
                    {o.value === 'contacts'
                      ? o.hint
                      : n
                        ? `${n} contact${n === 1 ? '' : 's'} ${o.value === 'contacts_except' ? 'excluded' : 'selected'}`
                        : o.hint}
                  </span>
                </span>
              </label>
              {o.value !== 'contacts' ? (
                <button
                  type="button"
                  aria-label={`Choose contacts for "${o.label}"`}
                  onClick={() => setPicking(o.value as 'contacts_except' | 'only_share_with')}
                  className="mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg"
                >
                  <ChevronRight size={18} aria-hidden />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-subtle">
        Changes to your privacy settings won't affect status updates that you've sent already.
      </p>
    </Modal>
  );
}

function ContactsPicker({
  open,
  title,
  initial,
  onCancel,
  onDone,
}: {
  open: boolean;
  title: string;
  initial: ID[];
  onCancel: () => void;
  onDone: (ids: ID[]) => void;
}) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ID[]>(initial);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .get<Contact[]>('/api/contacts')
      .then((c) => alive && setContacts(c))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (contacts ?? [])
      .filter((c) => !c.user.isDeleted)
      .filter(
        (c) =>
          !q || userDisplayName(c.user).toLowerCase().includes(q) || c.user.username.includes(q),
      )
      .sort((a, b) => userDisplayName(a.user).localeCompare(userDisplayName(b.user)));
  }, [contacts, query]);

  const all = list.length > 0 && list.every((c) => selected.includes(c.user.id));
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={`${selected.length} selected`}
      bodyClassName="px-0 py-0"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Back
          </Button>
          <Button onClick={() => onDone(selected)}>Done</Button>
        </>
      }
    >
      <div className="sticky top-0 z-[1] flex items-center gap-2 bg-elevated px-5 pb-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search contacts"
          className="flex-1"
        />
        {list.length ? (
          <button
            type="button"
            className="shrink-0 text-[13px] font-semibold text-brand-ink hover:underline"
            onClick={() =>
              setSelected((s) =>
                all
                  ? s.filter((id) => !list.some((c) => c.user.id === id))
                  : [...new Set([...s, ...list.map((c) => c.user.id)])],
              )
            }
          >
            {all ? 'Clear' : 'Select all'}
          </button>
        ) : null}
      </div>
      <div className="min-h-48 pb-2">
        {error ? (
          <EmptyState title="Couldn't load contacts" description={error} compact />
        ) : !contacts ? (
          <ListItemSkeleton count={5} />
        ) : !list.length ? (
          <EmptyState title={query ? 'No matches' : 'No contacts yet'} compact />
        ) : (
          list.map((c) => (
            <SelectRow
              key={c.user.id}
              checked={selected.includes(c.user.id)}
              onChange={(on) =>
                setSelected((s) => (on ? [...s, c.user.id] : s.filter((x) => x !== c.user.id)))
              }
              leading={<UserAvatar user={c.user} size="md" />}
              title={userDisplayName(c.user)}
              subtitle={c.user.about ?? `@${c.user.username}`}
            />
          ))
        )}
      </div>
    </Modal>
  );
}
