import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { AtSign, Phone } from 'lucide-react';
import {
  DISPLAY_NAME_MAX_LENGTH,
  type AddContactRequest,
  type Contact,
  type UserPublic,
} from '@enbox/shared';
import { Button, Input, Modal, Tabs, toast } from '@/components/ui';
import { canonicalPhone, normalizeUsernameInput, usernameIssue } from '@/features/auth/validation';
import { ApiError, errorMessage } from '@/lib/api';
import { useContacts } from '@/stores/contacts';

type Method = 'username' | 'phone';

/** Guess how a search query identifies someone (for prefilling the add dialog). */
export function guessIdentifier(query: string): { method: Method; value: string } {
  const q = query.trim();
  if (/^\+?[\d\s\-().]{6,}$/.test(q)) return { method: 'phone', value: q };
  return { method: 'username', value: normalizeUsernameInput(q) };
}

export interface AddContactDialogProps {
  open: boolean;
  onClose: () => void;
  /** Prefill from a search query. */
  initialQuery?: string;
  onAdded?: (contact: Contact) => void;
}

/** "New contact": by @username or phone number, with an optional saved name. */
export function AddContactDialog({ open, onClose, initialQuery, onAdded }: AddContactDialogProps) {
  const [method, setMethod] = useState<Method>('username');
  const [value, setValue] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formId = useId();

  useEffect(() => {
    if (!open) return;
    const g = initialQuery
      ? guessIdentifier(initialQuery)
      : { method: 'username' as const, value: '' };
    setMethod(g.method);
    setValue(g.value);
    setName('');
    setError(null);
    setBusy(false);
  }, [open, initialQuery]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let req: AddContactRequest;
    if (method === 'username') {
      const issue = value ? usernameIssue(value) : 'Enter a username';
      if (issue) return setError(issue);
      req = { username: value };
    } else {
      const phone = canonicalPhone(value);
      if (!phone) return setError('Enter a valid phone number with country code');
      req = { phone };
    }
    if (name.trim()) req.name = name.trim();
    setBusy(true);
    setError(null);
    try {
      const contact = await useContacts.getState().addContact(req);
      toast.success(`${contact.name ?? contact.user.displayName} added to contacts`);
      onAdded?.(contact);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404)
        setError(
          method === 'username'
            ? `No one on Enbox uses @${value}.`
            : 'No Enbox account uses this phone number.',
        );
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New contact"
      description="Find someone by their exact username or phone number."
      size="sm"
      initialFocus={inputRef}
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4 pt-1 pb-2">
        <Tabs<Method>
          variant="chips"
          aria-label="Find by"
          value={method}
          onChange={(m) => {
            setMethod(m);
            setValue('');
            setError(null);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          items={[
            {
              value: 'username',
              label: (
                <>
                  <AtSign size={15} aria-hidden /> Username
                </>
              ),
            },
            {
              value: 'phone',
              label: (
                <>
                  <Phone size={15} aria-hidden /> Phone
                </>
              ),
            },
          ]}
        />
        {method === 'username' ? (
          <Input
            ref={inputRef}
            label="Username"
            prefix="@"
            value={value}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setValue(normalizeUsernameInput(e.target.value));
              setError(null);
            }}
            error={error ?? undefined}
          />
        ) : (
          <Input
            ref={inputRef}
            label="Phone number"
            type="tel"
            inputMode="tel"
            placeholder="+1 555 123 4567"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            error={error ?? undefined}
            hint="Include the country code."
          />
        )}
        <Input
          label="Save as"
          aside="Optional"
          placeholder="Their profile name"
          value={name}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          onChange={(e) => setName(e.target.value)}
        />
      </form>
      <div className="flex justify-end gap-2 pt-2 pb-3">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" form={formId} loading={busy}>
          Add contact
        </Button>
      </div>
    </Modal>
  );
}

export interface EditContactDialogProps {
  user: UserPublic | null;
  onClose: () => void;
}

/** Rename a saved contact (empty = use their profile name) or save a new one by id. */
export function EditContactDialog({ user, onClose }: EditContactDialogProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const isContact = !!user?.isContact;

  useEffect(() => {
    if (user) {
      setName(user.contactName ?? user.displayName);
      setError(null);
      setBusy(false);
    }
  }, [user]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const trimmed = name.trim();
    setBusy(true);
    try {
      if (isContact) {
        await useContacts
          .getState()
          .renameContact(user.id, trimmed && trimmed !== user.displayName ? trimmed : null);
        toast.success('Contact updated');
      } else {
        await useContacts.getState().addContact({
          userId: user.id,
          ...(trimmed && trimmed !== user.displayName ? { name: trimmed } : {}),
        });
        toast.success(`${trimmed || user.displayName} added to contacts`);
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={isContact ? 'Edit contact' : 'Add to contacts'}
      size="sm"
      initialFocus={inputRef}
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3 pt-1 pb-2">
        <Input
          ref={inputRef}
          label="Name"
          value={name}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          error={error ?? undefined}
          hint={
            user
              ? `Only you see this name. Their profile name is “${user.displayName}”.`
              : undefined
          }
        />
      </form>
      <div className="flex justify-end gap-2 pt-2 pb-3">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" form={formId} loading={busy}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
