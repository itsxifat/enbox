/**
 * Channel admin composer: text posts, photo/video/document attachments (optimistic upload)
 * and polls. Enter sends per the device preference.
 */
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  BarChart3,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Plus,
  SendHorizontal,
  Trash2,
} from 'lucide-react';
import {
  MAX_CAPTION_LENGTH,
  POLL_MAX_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  POLL_QUESTION_MAX_LENGTH,
  pollInputSchema,
  type ChatSummary,
} from '@enbox/shared';
import {
  Button,
  DropdownMenu,
  IconButton,
  Input,
  Modal,
  Switch,
  Textarea,
  toast,
} from '@/components/ui';
import { api } from '@/lib/api';
import { validate } from '@/lib/forms';
import { newClientId } from '@/lib/ids';
import { createObjectUrl, mediaKindForFile, probeMedia } from '@/lib/media';
import { useMessages } from '@/stores/messages';
import { useUi } from '@/stores/ui';

export function ChannelComposer({ chat }: { chat: ChatSummary }) {
  const [text, setText] = useState('');
  const [pollOpen, setPollOpen] = useState(false);
  const enterToSend = useUi((s) => s.prefs.enterToSend);
  const photoInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    useMessages
      .getState()
      .sendMessage(chat.id, { type: 'text', text: body })
      .catch((err: unknown) => toast.error(err));
    textRef.current?.focus();
  };

  const sendFile = async (file: File, asDocument: boolean) => {
    const kind = asDocument ? 'file' : mediaKindForFile(file);
    const caption = text.trim().slice(0, MAX_CAPTION_LENGTH) || undefined;
    if (caption) setText('');
    const clientId = newClientId();
    const localUrl = kind === 'image' || kind === 'video' ? createObjectUrl(file) : undefined;
    const store = useMessages.getState();
    store.addOptimistic(chat.id, {
      clientId,
      type: kind,
      text: caption ?? null,
      localUrl,
      uploadProgress: 0,
    });
    try {
      const media = await api.upload(file, await probeMedia(file, kind), (p) =>
        useMessages.getState().patchOptimistic(chat.id, clientId, { uploadProgress: p }),
      );
      await useMessages
        .getState()
        .sendMessage(chat.id, { clientId, type: kind, mediaId: media.id, text: caption });
    } catch (err) {
      useMessages.getState().markFailed(chat.id, clientId);
      toast.error(err);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && enterToSend && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <form
      onSubmit={send}
      className="flex shrink-0 items-end gap-2 border-t border-line bg-surface px-3 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]"
      aria-label="New post"
    >
      <DropdownMenu
        aria-label="Attach"
        align="start"
        items={[
          {
            label: 'Photos & videos',
            icon: ImageIcon,
            onSelect: () => photoInput.current?.click(),
          },
          { label: 'Document', icon: FileText, onSelect: () => docInput.current?.click() },
          { label: 'Poll', icon: BarChart3, onSelect: () => setPollOpen(true) },
        ]}
        trigger={(t) => <IconButton {...t} icon={Paperclip} label="Attach" size="lg" />}
      />
      <Textarea
        ref={textRef}
        autoResize
        maxRows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Write a post"
        aria-label="Write a post"
        variant="filled"
        containerClassName="flex-1"
      />
      <IconButton
        type="submit"
        icon={SendHorizontal}
        label="Post"
        variant="brand"
        size="lg"
        disabled={!text.trim()}
      />
      <input
        ref={photoInput}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          for (const f of files) void sendFile(f, false);
        }}
      />
      <input
        ref={docInput}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void sendFile(f, true);
        }}
      />
      <PollModal chat={chat} open={pollOpen} onClose={() => setPollOpen(false)} />
    </form>
  );
}

function PollModal({
  chat,
  open,
  onClose,
}: {
  chat: ChatSummary;
  open: boolean;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setQuestion('');
    setOptions(['', '']);
    setMultiple(false);
    setError(null);
  };

  const submit = () => {
    const poll = {
      question: question.trim(),
      options: options.map((o) => o.trim()).filter(Boolean),
      allowMultiple: multiple,
    };
    const v = validate(pollInputSchema, poll);
    if (!v.ok) {
      setError(
        v.errors.question
          ? 'Ask a question'
          : v.errors.options?.includes('different')
            ? 'Options must be different'
            : 'Add at least two options',
      );
      return;
    }
    useMessages
      .getState()
      .sendMessage(chat.id, { type: 'poll', poll: v.data })
      .catch((e: unknown) => toast.error(e));
    reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create poll"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} leftIcon={SendHorizontal}>
            Post poll
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <Input
          label="Question"
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, POLL_QUESTION_MAX_LENGTH))}
          placeholder="Ask a question"
          autoFocus
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-fg">Options</legend>
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input
                aria-label={`Option ${i + 1}`}
                value={o}
                onChange={(e) => {
                  const v = e.target.value.slice(0, POLL_OPTION_MAX_LENGTH);
                  setOptions((list) => {
                    const next = list.map((x, j) => (j === i ? v : x));
                    // Grow automatically when the last option gets text.
                    if (i === next.length - 1 && v && next.length < POLL_MAX_OPTIONS) next.push('');
                    return next;
                  });
                }}
                placeholder={`Option ${i + 1}`}
                containerClassName="flex-1"
              />
              {options.length > 2 ? (
                <IconButton
                  icon={Trash2}
                  label={`Remove option ${i + 1}`}
                  size="sm"
                  onClick={() => setOptions((l) => l.filter((_, j) => j !== i))}
                />
              ) : null}
            </div>
          ))}
          {options.length < POLL_MAX_OPTIONS && options.every(Boolean) ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={Plus}
              onClick={() => setOptions((l) => [...l, ''])}
              className="self-start"
            >
              Add option
            </Button>
          ) : null}
        </fieldset>
        <Switch label="Allow multiple answers" checked={multiple} onChange={setMultiple} />
        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
