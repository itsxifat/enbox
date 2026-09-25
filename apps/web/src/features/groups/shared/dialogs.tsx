/** Small modals shared by info panels: mute, disappearing timer, edit name/description. */
import { useEffect, useState, type FormEvent } from 'react';
import { DISAPPEARING_OPTIONS, formatTimer } from '@enbox/shared';
import { Button, Input, Modal, RadioGroup, Textarea, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { MUTE_OPTIONS, muteUntil, type MuteChoice } from './chatActions';

export function MuteModal({
  open,
  onClose,
  onMute,
  kind = 'chat',
}: {
  open: boolean;
  onClose: () => void;
  onMute: (until: string) => Promise<unknown>;
  kind?: 'chat' | 'group' | 'channel';
}) {
  const [choice, setChoice] = useState<MuteChoice>('8h');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setChoice('8h');
  }, [open]);
  const submit = async () => {
    setBusy(true);
    try {
      await onMute(muteUntil(choice));
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Mute notifications"
      description={
        kind === 'channel'
          ? 'You won’t see new-post badges for this channel.'
          : `Other ${kind === 'group' ? 'members' : 'people'} won’t see that you muted this chat.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Mute
          </Button>
        </>
      }
    >
      <RadioGroup
        aria-label="Mute for"
        value={choice}
        onChange={setChoice}
        options={MUTE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
      />
    </Modal>
  );
}

type TimerValue = 'off' | `${number}`;

export function DisappearingModal({
  open,
  onClose,
  current,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  current: number | null;
  onSave: (seconds: number | null) => Promise<unknown>;
}) {
  const [value, setValue] = useState<TimerValue>('off');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setValue(current ? (String(current) as TimerValue) : 'off');
  }, [open, current]);
  const submit = async () => {
    const seconds = value === 'off' ? null : Number(value);
    if (seconds === current) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await onSave(seconds);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Disappearing messages"
      description="New messages will disappear from this chat after the selected duration. Anyone in the chat can still save or forward them."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <RadioGroup
        aria-label="Message timer"
        value={value}
        onChange={setValue}
        options={[
          ...DISAPPEARING_OPTIONS.map((s) => ({
            value: String(s) as TimerValue,
            label: formatTimer(s),
          })),
          { value: 'off' as TimerValue, label: 'Off' },
        ]}
      />
    </Modal>
  );
}

export function disappearingLabel(seconds: number | null): string {
  return seconds ? formatTimer(seconds) : 'Off';
}

/** Edit name + description together (community / channel "Edit" actions). */
export function EditInfoModal({
  open,
  onClose,
  title,
  initialName,
  initialDescription,
  nameMax,
  descriptionMax,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  initialName: string;
  initialDescription: string;
  nameMax: number;
  descriptionMax: number;
  onSave: (v: { name?: string; description?: string | null }) => Promise<unknown>;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription(initialDescription);
      setError(null);
    }
  }, [open, initialName, initialDescription]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const n = name.trim();
    const d = description.trim();
    if (!n) {
      setError("Name can't be empty");
      return;
    }
    const patch: { name?: string; description?: string | null } = {};
    if (n !== initialName.trim()) patch.name = n;
    if (d !== initialDescription.trim()) patch.description = d || null;
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await onSave(patch);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4 pb-1">
        <Input
          label="Name"
          aside={`${Array.from(name).length}/${nameMax}`}
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, nameMax))}
          error={error}
          autoFocus
        />
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, descriptionMax))}
          autoResize
          rows={3}
          maxRows={8}
        />
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

/** Edit a single text field (name or description) in a modal. */
export function EditTextModal({
  open,
  onClose,
  title,
  label,
  initial,
  maxLength,
  multiline,
  required,
  placeholder,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  label: string;
  initial: string;
  maxLength: number;
  multiline?: boolean;
  required?: boolean;
  placeholder?: string;
  onSave: (value: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setValue(initial);
      setError(null);
    }
  }, [open, initial]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const v = value.trim();
    if (required && !v) {
      setError(`${label} can't be empty`);
      return;
    }
    if (v === initial.trim()) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await onSave(v);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const count = `${Array.from(value).length}/${maxLength}`;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="pb-1">
        {multiline ? (
          <Textarea
            label={label}
            aside={count}
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, maxLength))}
            autoResize
            maxRows={8}
            rows={3}
            placeholder={placeholder}
            error={error}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
            }}
          />
        ) : (
          <Input
            label={label}
            aside={count}
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, maxLength))}
            placeholder={placeholder}
            error={error}
            autoFocus
          />
        )}
      </form>
    </Modal>
  );
}
