import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Input, Modal } from '@/components/ui';
import { errorMessage } from '@/lib/api';

export interface EditFieldModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  label: string;
  initialValue: string;
  /** Client-side check; return an error message or null. */
  validate?: (value: string) => string | null;
  /** Persist; throw to show the error under the field. */
  onSave: (value: string) => Promise<void>;
  maxLength?: number;
  hint?: ReactNode;
  /** Live status under the field (e.g. username availability); replaces the hint. */
  status?: (value: string) => ReactNode;
  prefix?: string;
  inputMode?: 'text' | 'tel' | 'email';
  placeholder?: string;
  transform?: (value: string) => string;
  /** Extra button on the left of the footer (e.g. "Remove"). */
  extraAction?: ReactNode;
  autoComplete?: string;
  saveLabel?: string;
}

/** Small form dialog for editing one profile field (name, username, phone…). */
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
}: EditFieldModalProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formId = useId();

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(null);
      setBusy(false);
    }
  }, [open, initialValue]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
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
    <Modal open={open} onClose={onClose} title={title} size="sm" initialFocus={inputRef}>
      <form id={formId} onSubmit={submit} noValidate className="pt-1 pb-2">
        <Input
          ref={inputRef}
          label={label}
          aside={counter}
          value={value}
          onChange={(e) => {
            setValue(transform ? transform(e.target.value) : e.target.value);
            setError(null);
          }}
          maxLength={maxLength}
          error={error ?? undefined}
          hint={liveStatus ?? hint}
          prefix={prefix}
          inputMode={inputMode}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCapitalize={inputMode === 'text' && !prefix ? 'sentences' : 'none'}
          spellCheck={inputMode === 'text' && !prefix}
        />
      </form>
      <div className="flex items-center justify-end gap-2 pt-3 pb-3">
        {extraAction ? <div className="mr-auto">{extraAction}</div> : null}
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" form={formId} loading={busy}>
          {saveLabel}
        </Button>
      </div>
    </Modal>
  );
}
