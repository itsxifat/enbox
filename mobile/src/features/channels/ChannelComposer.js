/**
 * Channel admin composer (web features/channels/ChannelComposer.tsx): text posts,
 * photo/video/document attachments (processed and uploaded like chat media) and polls.
 */
import { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BarChart3, Camera, FileText, Image as ImageIcon, Paperclip } from 'lucide-react-native';
import { SendIcon } from '@/components/icons';
import { ActionSheet, IconButton, toast } from '@/components/ui';
import { PollDialog } from '@/features/conversation/composer/AttachDialogs';
import {
  pickDocuments,
  pickMedia,
  takeWithCamera,
} from '@/features/conversation/lib/mediaProcessing';
import { useMessages } from '@/stores/messages';
import { useUi } from '@/stores/ui';
import { alpha, useTheme } from '@/theme';
import { postFiles } from './postMedia';

export function ChannelComposer({ chat }) {
  const { tw, c, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [attach, setAttach] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const enterToSend = useUi((s) => s.prefs.enterToSend);
  const input = useRef(null);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    useMessages
      .getState()
      .sendMessage(chat.id, { type: 'text', text: body })
      .catch((err) => toast.error(err));
  };

  const sendFiles = (files, asDocument) => {
    if (!files.length) return;
    const caption = text.trim() || undefined;
    if (caption) setText('');
    void postFiles(chat.id, files, { asDocument, caption });
  };

  return (
    <View
      style={[
        tw`mx-2 mt-2 flex-row items-end gap-2 rounded-xl bg-surface-2 px-3 py-2`,
        { marginBottom: Math.max(8, insets.bottom) },
        shadow.bubble,
      ]}
    >
      <IconButton icon={Paperclip} label="Attach" size="lg" onPress={() => setAttach(true)} />
      <TextInput
        ref={input}
        value={text}
        onChangeText={setText}
        multiline
        placeholder="Write a post"
        placeholderTextColor={c.subtle}
        accessibilityLabel="Write a post"
        submitBehavior={enterToSend ? 'submit' : 'newline'}
        onSubmitEditing={enterToSend ? send : undefined}
        selectionColor={alpha(c.brand, 0.5)}
        cursorColor={c.brand}
        style={[
          tw`min-w-0 flex-1 rounded-3xl px-4 text-[15px] text-fg`,
          {
            minHeight: 48,
            maxHeight: 20 * 6 + 22,
            paddingTop: 13,
            paddingBottom: 13,
            backgroundColor: c.surface,
          },
        ]}
      />
      <IconButton
        icon={SendIcon}
        label="Post"
        variant="brand"
        size="lg"
        disabled={!text.trim()}
        onPress={send}
      />
      <ActionSheet
        open={attach}
        onClose={() => setAttach(false)}
        items={[
          {
            label: 'Photos & videos',
            icon: ImageIcon,
            onSelect: () => void pickMedia().then((f) => sendFiles(f, false)),
          },
          {
            label: 'Camera',
            icon: Camera,
            onSelect: () => void takeWithCamera().then((f) => sendFiles(f, false)),
          },
          {
            label: 'Document',
            icon: FileText,
            onSelect: () => void pickDocuments().then((f) => sendFiles(f.slice(0, 1), true)),
          },
          { label: 'Poll', icon: BarChart3, onSelect: () => setPollOpen(true) },
        ]}
      />
      <PollDialog
        open={pollOpen}
        onClose={() => setPollOpen(false)}
        onSend={(poll) =>
          useMessages
            .getState()
            .sendMessage(chat.id, { type: 'poll', poll })
            .catch((e) => toast.error(e))
        }
      />
    </View>
  );
}
