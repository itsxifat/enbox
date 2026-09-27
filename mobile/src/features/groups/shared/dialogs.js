/**
 * Small modals shared by info panels (web features/groups/shared/dialogs.tsx): mute,
 * disappearing timer, edit name/description.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { DISAPPEARING_OPTIONS, formatTimer } from '@enbox/shared';
import { Button, Input, Modal, RadioGroup, Textarea, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useTheme } from '@/theme';
import { MUTE_OPTIONS, muteUntil } from './chatActions';

function Footer({ onCancel, onSave, busy, saveLabel = 'Save' }) {
  return (
    <>
      <Button variant="ghost" onPress={onCancel}>
        Cancel
      </Button>
      <Button onPress={onSave} loading={busy}>
        {saveLabel}
      </Button>
    </>
  );
}

export function MuteModal({ open, onClose, onMute, kind = 'chat' }) {
  const [choice, setChoice] = useState('8h');
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
      title="Mute notifications"
      description={
        kind === 'channel'
          ? 'You won’t see new-post badges for this channel.'
          : `Other ${kind === 'group' ? 'members' : 'people'} won’t see that you muted this chat.`
      }
      footer={
        <Footer onCancel={onClose} onSave={() => void submit()} busy={busy} saveLabel="Mute" />
      }
    >
      <RadioGroup
        value={choice}
        onChange={setChoice}
        options={MUTE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
      />
    </Modal>
  );
}

export function DisappearingModal({ open, onClose, current, onSave }) {
  const [value, setValue] = useState('off');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setValue(current ? String(current) : 'off');
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
      title="Disappearing messages"
      description="New messages will disappear from this chat after the selected duration. Anyone in the chat can still save or forward them."
      footer={<Footer onCancel={onClose} onSave={() => void submit()} busy={busy} />}
    >
      <RadioGroup
        value={value}
        onChange={setValue}
        options={[
          ...DISAPPEARING_OPTIONS.map((s) => ({ value: String(s), label: formatTimer(s) })),
          { value: 'off', label: 'Off' },
        ]}
      />
    </Modal>
  );
}

export function disappearingLabel(seconds) {
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
}) {
  const { tw } = useTheme();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription(initialDescription);
      setError(null);
    }
  }, [open, initialName, initialDescription]);

  const submit = async () => {
    const n = name.trim();
    const d = description.trim();
    if (!n) {
      setError("Name can't be empty");
      return;
    }
    const patch = {};
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
      title={title}
      footer={<Footer onCancel={onClose} onSave={() => void submit()} busy={busy} />}
    >
      <View style={tw`gap-4 pb-1`}>
        <Input
          label="Name"
          aside={`${Array.from(name).length}/${nameMax}`}
          value={name}
          onChangeText={(v) => setName(v.slice(0, nameMax))}
          error={error ?? undefined}
          autoFocus
        />
        <Textarea
          label="Description"
          value={description}
          onChangeText={(v) => setDescription(v.slice(0, descriptionMax))}
          minRows={3}
          maxRows={8}
        />
      </View>
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
}) {
  const { tw } = useTheme();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setValue(initial);
      setError(null);
    }
  }, [open, initial]);

  const submit = async () => {
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
      title={title}
      footer={<Footer onCancel={onClose} onSave={() => void submit()} busy={busy} />}
    >
      <View style={tw`pb-1`}>
        {multiline ? (
          <Textarea
            label={label}
            aside={count}
            value={value}
            onChangeText={(v) => setValue(v.slice(0, maxLength))}
            minRows={3}
            maxRows={8}
            placeholder={placeholder}
            error={error ?? undefined}
            autoFocus
          />
        ) : (
          <Input
            label={label}
            aside={count}
            value={value}
            onChangeText={(v) => setValue(v.slice(0, maxLength))}
            onSubmitEditing={() => void submit()}
            placeholder={placeholder}
            error={error ?? undefined}
            autoFocus
          />
        )}
      </View>
    </Modal>
  );
}
