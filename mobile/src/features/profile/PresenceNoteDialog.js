/**
 * "Set a custom status" (web features/profile/PresenceNoteDialog.tsx): an emoji, text up to
 * PRESENCE_NOTE_MAX_LENGTH and when it clears → PUT /api/me/presence-note; "Clear status" →
 * DELETE. Opened from my own profile card.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Smile, X } from 'lucide-react-native';
import { PRESENCE_NOTE_MAX_LENGTH, activePresenceNote } from '@enbox/shared';
import { Icon } from '@/components/icons';
import { Button, IconButton, Input, Modal, Press, RadioGroup, T, toast } from '@/components/ui';
import { EmojiPanel } from '@/features/emoji/EmojiPanel';
import { errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { useTheme } from '@/theme';
import { NOTE_DURATIONS, clearPresenceNote, expiryFor, setPresenceNote } from './presenceApi';

const durationOptions = NOTE_DURATIONS.map((d) => ({ value: d.value, label: d.label }));

export function PresenceNoteDialog({ open, onClose }) {
  const { tw, c } = useTheme();
  const me = useMe();
  const current = activePresenceNote(me?.presenceNote);
  const currentRef = useRef(current);
  currentRef.current = current;
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(null);
  const [duration, setDuration] = useState('never');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText(currentRef.current?.text ?? '');
    setEmoji(currentRef.current?.emoji ?? null);
    setDuration('never');
    setPickerOpen(false);
    setError(null);
    setBusy(false);
  }, [open]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed && !emoji) {
      setError('Add some text or an emoji');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setPresenceNote({ text: trimmed || null, emoji, expiresAt: expiryFor(duration) });
      toast.success('Status set');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await clearPresenceNote();
      toast.success('Status cleared');
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const counter = String(Math.max(0, PRESENCE_NOTE_MAX_LENGTH - Array.from(text).length));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Set a custom status"
      footer={
        <>
          {current ? (
            <Button
              variant="ghost"
              textStyle={tw`text-danger`}
              style={tw`mr-auto`}
              onPress={() => void clear()}
              disabled={busy}
            >
              Clear status
            </Button>
          ) : null}
          <Button variant="ghost" onPress={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onPress={() => void submit()} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <View style={tw`gap-4 pt-1 pb-2`}>
        <View style={tw`flex-row items-start gap-2`}>
          <Press
            accessibilityLabel={emoji ? `Emoji: ${emoji}` : 'Pick an emoji'}
            onPress={() => setPickerOpen((v) => !v)}
            style={tw`mt-6.5 size-11 items-center justify-center rounded-xl bg-surface-2`}
          >
            {emoji ? (
              <T style={{ fontSize: 22, lineHeight: 28 }}>{emoji}</T>
            ) : (
              <Icon icon={Smile} size={22} color={c.muted} />
            )}
          </Press>
          <Input
            label="What's your status?"
            aside={counter}
            value={text}
            onChangeText={(v) => {
              setText(v);
              setError(null);
            }}
            maxLength={PRESENCE_NOTE_MAX_LENGTH}
            placeholder="Focus time"
            error={error ?? undefined}
            autoComplete="off"
            onSubmitEditing={() => void submit()}
            containerStyle={tw`min-w-0 flex-1`}
          />
          {emoji ? (
            <IconButton
              icon={X}
              label="Remove emoji"
              size="sm"
              style={tw`mt-7.5`}
              onPress={() => setEmoji(null)}
            />
          ) : null}
        </View>
        {pickerOpen ? (
          <View style={[tw`overflow-hidden rounded-xl bg-surface-2`, { height: 300 }]}>
            <EmojiPanel
              height={300}
              onPick={(e) => {
                setEmoji(e);
                setPickerOpen(false);
              }}
            />
          </View>
        ) : null}
        <RadioGroup
          label="Clear after"
          value={duration}
          onChange={setDuration}
          options={durationOptions}
        />
        {current?.expiresAt ? (
          <T style={tw`text-[12.5px] text-muted`}>
            Your current status clears at {formatTime(current.expiresAt)}.
          </T>
        ) : null}
      </View>
    </Modal>
  );
}
