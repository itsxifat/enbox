/**
 * Remind Me ▸ Custom…: a date and a time (in the future) for a reminder. Opened from anywhere
 * with `openReminderDialog`; NotificationsHost renders the open one (`ReminderDialogHost`).
 */
import { useState, type FormEvent } from 'react';
import { create } from 'zustand';
import { Button, Input, Modal } from '@/components/ui';
import { registerSessionReset } from '@/lib/session';
import { setReminder, type BookmarkTarget } from './actions';
import { formatReminderTime, fromInputs, presetTime, toDateInput, toTimeInput } from './reminders';

interface DialogState {
  target: BookmarkTarget | null;
  /** The reminder it has now (the picker starts there when it is still ahead). */
  current: string | null;
}

const useReminderDialog = create<DialogState>(() => ({ target: null, current: null }));
registerSessionReset(() => useReminderDialog.setState({ target: null, current: null }));

export function openReminderDialog(target: BookmarkTarget, current: string | null = null): void {
  useReminderDialog.setState({ target, current });
}

export function ReminderDialogHost() {
  const { target, current } = useReminderDialog();
  if (!target) return null;
  return (
    <ReminderDialog
      key={target.messageId}
      target={target}
      current={current}
      onClose={() => useReminderDialog.setState({ target: null, current: null })}
    />
  );
}

export function ReminderDialog({
  target,
  current,
  onClose,
}: {
  target: BookmarkTarget;
  current: string | null;
  onClose: () => void;
}) {
  const [start] = useState(() =>
    current && Date.parse(current) > Date.now() ? new Date(current) : presetTime('tomorrow'),
  );
  const [date, setDate] = useState(() => toDateInput(start));
  const [time, setTime] = useState(() => toTimeInput(start));
  const at = fromInputs(date, time);
  const past = !!at && at.getTime() <= Date.now();

  const save = () => {
    if (!at || past) return;
    void setReminder(target, at.toISOString());
    onClose();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Remind me"
      description="Pick when to be reminded about this message."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!at || past}>
            Set reminder
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Input
          type="date"
          label="Date"
          value={date}
          min={toDateInput(new Date())}
          onChange={(e) => setDate(e.target.value)}
        />
        <Input
          type="time"
          label="Time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          error={past ? 'Pick a time in the future' : undefined}
          hint={at && !past ? formatReminderTime(at.toISOString()) : undefined}
        />
      </form>
    </Modal>
  );
}
