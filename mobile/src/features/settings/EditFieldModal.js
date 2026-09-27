/** Small form dialog for editing one profile field (web features/settings/EditFieldModal.tsx). */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Input, Modal } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useTheme } from '@/theme';

export function EditFieldModal({
  open,
  onClose,
  title,
  label,
  initialValue,
  validate,
  onSave,
  maxLength,
  hint,
  status,
  prefix,
  inputMode = 'text',
  placeholder,
  transform,
  extraAction,
  autoComplete = 'off',
  saveLabel = 'Save',
}) {
  const { tw } = useTheme();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(null);
      setBusy(false);
    }
  }, [open, initialValue]);

  const submit = async () => {
    const issue = validate?.(value) ?? null;
    if (issue) {
      setError(issue);
      return;
    }
    if (value.trim() === initialValue.trim()) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(value);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const liveStatus = status?.(value);
  const counter =
    maxLength !== undefined ? `${Math.max(0, maxLength - Array.from(value).length)}` : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          {extraAction ? <View style={tw`mr-auto`}>{extraAction}</View> : null}
          <Button variant="ghost" onPress={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onPress={() => void submit()} loading={busy}>
            {saveLabel}
          </Button>
        </>
      }
    >
      <View style={tw`pt-1 pb-2`}>
        <Input
          label={label}
          aside={counter}
          value={value}
          autoFocus
          onChangeText={(v) => {
            setValue(transform ? transform(v) : v);
            setError(null);
          }}
          onSubmitEditing={() => void submit()}
          maxLength={maxLength}
          error={error ?? undefined}
          hint={liveStatus ?? hint}
          prefix={prefix}
          keyboardType={
            inputMode === 'tel' ? 'phone-pad' : inputMode === 'email' ? 'email-address' : 'default'
          }
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCapitalize={inputMode === 'text' && !prefix ? 'sentences' : 'none'}
          autoCorrect={inputMode === 'text' && !prefix}
        />
      </View>
    </Modal>
  );
}
