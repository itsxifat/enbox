/**
 * Message composer: auto-growing text field, emoji picker (lazy), Enter-to-send (device
 * preference; touch keyboards insert newlines), typing/recording indicators, @mention
 * suggestions in groups, reply/edit banners, drafts, attachments (photos & videos with
 * preview + captions, camera, documents, audio, location, contact, poll), paste/drop of
 * files and voice notes (tap to record locked, or hold: release sends, slide left cancels,
 * slide up locks).
 */
import {
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  Check,
  Mic,
  Paperclip,
  Pencil,
  SendHorizontal,
  Smile,
  X,
  Camera,
  Keyboard,
} from 'lucide-react';
import {
  MAX_MESSAGE_LENGTH,
  MAX_UPLOAD_BYTES,
  formatBytes,
  userDisplayName,
  type ChatSummary,
  type UserPublic,
} from '@enbox/shared';
import { IconButton, Spinner } from '@/components/ui';
import { useIsDesktop, useIsTouch } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { readAudioDuration } from '@/lib/media';
import { playSound } from '@/lib/notify';
import { useAuth } from '@/stores/auth';
import { useMessages, type ClientMessage } from '@/stores/messages';
import { confirm, toast, useUi } from '@/stores/ui';
import { mentionName } from '@/features/chats/preview';
import { getDraft, useDrafts } from '@/features/chats/drafts';
import { canEdit, previewOf, saveEdit } from '../actions';
import { ReplyQuote } from '../bubbles/Quote';
import { LazyEmojiPicker } from '../lazy';
import {
  activeMentionQuery,
  decodeMentions,
  encodeMentions,
  insertMention,
  matchesMentionQuery,
  pruneRefs,
  type MentionQuery,
  type MentionRef,
} from '../lib/composerMentions';
import { isVisualMedia, prepareVisualMedia } from '../lib/mediaProcessing';
import { VoiceRecording, recordingSupported } from '../lib/recorder';
import { enqueueMedia, sendMedia } from '../lib/sendMedia';
import { sendQueued } from '../lib/outbox';
import { createTypingEmitter } from '../lib/typing';
import { useChatMembers } from '../members';
import { useConversationUi } from '../state';
import { AttachMenu, type AttachKind } from './AttachMenu';
import { CameraDialog, ContactPickerDialog, LocationDialog, PollDialog } from './AttachDialogs';
import { MediaPreviewDialog } from './MediaPreviewDialog';
import { MentionSuggestions } from './MentionSuggestions';
import { VoiceRecorderBar } from './VoiceRecorderBar';

const MAX_ROWS = 6;
const HOLD_MS = 220;

type Dialog = 'location' | 'contact' | 'poll' | 'camera' | null;

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  const cs = getComputedStyle(el);
  const line = parseFloat(cs.lineHeight) || 20;
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const max = line * MAX_ROWS + pad;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
}

export function Composer({ chat }: { chat: ChatSummary }) {
  const meId = useAuth((s) => s.user?.id);
  const enterToSend = useUi((s) => s.prefs.enterToSend);
  const sounds = useUi((s) => s.prefs.sounds);
  const touch = useIsTouch();
  const desktop = useIsDesktop();
  const reply = useConversationUi((s) => s.reply[chat.id]);
  const editing = useConversationUi((s) => s.editing[chat.id]);
  const focusToken = useConversationUi((s) => s.focusToken);
  const members = useChatMembers(chat);
  const listId = useId();

  const initial = useMemo(() => {
    const d = getDraft(chat.id);
    return d ? decodeMentions(d.text, mentionName) : { text: '', refs: [] as MentionRef[] };
    // Only on mount for this chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [text, setText] = useState(initial.text);
  const refs = useRef<MentionRef[]>(initial.refs);
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachAnchor, setAttachAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [preview, setPreview] = useState<File[] | null>(null);
  const [voice, setVoice] = useState<{ rec: VoiceRecording; locked: boolean } | null>(null);
  const [starting, setStarting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const sendButton = useRef<HTMLButtonElement>(null);
  const stash = useRef<{ text: string; refs: MentionRef[] } | null>(null);
  const hold = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    x: number;
    y: number;
    started: boolean;
  } | null>(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const typing = useMemo(() => createTypingEmitter(chat.id), [chat.id]);
  useEffect(() => () => typing.dispose(), [typing]);
  useEffect(
    () => () => {
      voiceRef.current?.rec.cancel();
    },
    [],
  );

  useLayoutEffect(() => autosize(ta.current), [text]);

  // Restore the draft's reply target once history is loaded.
  const draftReplyId = useRef(getDraft(chat.id)?.replyToId);
  const loaded = useMessages((s) => !!s.byChat[chat.id]?.loaded);
  useEffect(() => {
    const id = draftReplyId.current;
    if (!loaded || !id) return;
    draftReplyId.current = undefined;
    const m = useMessages.getState().byChat[chat.id]?.items.find((x) => x.id === id);
    if (m && !useConversationUi.getState().reply[chat.id])
      useConversationUi.getState().setReply(chat.id, m);
  }, [loaded, chat.id]);

  // Persist the draft (not while editing another message).
  useEffect(() => {
    if (editing) return;
    useDrafts.getState().setDraft(chat.id, encodeMentions(text, refs.current), reply?.id ?? null);
  }, [text, reply?.id, editing, chat.id]);

  // Entering/leaving edit mode swaps the composer content.
  const editingId = editing?.id;
  useEffect(() => {
    if (!editingId) {
      if (stash.current) {
        setText(stash.current.text);
        refs.current = stash.current.refs;
        stash.current = null;
      }
      return;
    }
    const m = useConversationUi.getState().editing[chat.id];
    if (!m) return;
    if (!stash.current) stash.current = { text, refs: refs.current };
    const decoded = decodeMentions(m.text ?? '', mentionName);
    setText(decoded.text);
    refs.current = decoded.refs;
    requestAnimationFrame(() => {
      const el = ta.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, chat.id]);

  const firstFocus = useRef(focusToken);
  useEffect(() => {
    if (firstFocus.current === focusToken) return;
    ta.current?.focus();
  }, [focusToken]);

  // Desktop: focus the field when the chat opens.
  useEffect(() => {
    if (desktop) ta.current?.focus({ preventScroll: true });
  }, [desktop]);

  const suggestions = useMemo<UserPublic[]>(() => {
    if (!mention || chat.type !== 'group' || !members) return [];
    return members
      .map((mm) => mm.user)
      .filter(
        (u) =>
          u.id !== meId && !u.isDeleted && matchesMentionQuery(userDisplayName(u), mention.query),
      )
      .slice(0, 8);
  }, [mention, chat.type, members, meId]);

  const updateMention = (value: string, caret: number) => {
    if (chat.type !== 'group') return;
    const q = activeMentionQuery(value, caret);
    setMention(q);
    setMentionIdx(0);
  };

  const onChange = (value: string, caret: number) => {
    setText(value);
    refs.current = pruneRefs(value, refs.current);
    if (value.trim()) typing.keystroke();
    else typing.stop();
    updateMention(value, caret);
  };

  const pickMention = (u: UserPublic) => {
    const el = ta.current;
    if (!mention || !el) return;
    const name = userDisplayName(u);
    const res = insertMention(text, mention, el.selectionStart, name);
    refs.current = [...refs.current.filter((r) => r.userId !== u.id), { userId: u.id, name }];
    setText(res.text);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(res.caret, res.caret);
    });
  };

  const insertAtCaret = (s: string) => {
    const el = ta.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + s + text.slice(end);
    setText(next);
    typing.keystroke();
    requestAnimationFrame(() => {
      if (!el) return;
      if (!touch) el.focus();
      el.setSelectionRange(start + s.length, start + s.length);
    });
  };

  /**
   * After sending something that doesn't consume the typed text (documents, audio files,
   * location, contact, poll): the reply was used, but the text and its draft stay.
   */
  const clearAfterAttachmentSend = () => {
    setMention(null);
    useConversationUi.getState().setReply(chat.id, null);
    typing.stop();
    useConversationUi.getState().requestBottom();
  };

  /** After sending the typed text itself (as a message, or as captions). */
  const clearAfterSend = () => {
    setText('');
    refs.current = [];
    useDrafts.getState().clearDraft(chat.id);
    clearAfterAttachmentSend();
  };

  /**
   * Keyboard users who send with the Send button keep their place: the button is swapped for
   * the mic once the text is gone, so move focus back to the field instead of <body>.
   */
  const keepFocus = (el: HTMLElement) => {
    if (document.activeElement !== el) return;
    requestAnimationFrame(() => {
      if (!el.isConnected || document.activeElement === document.body)
        ta.current?.focus({ preventScroll: true });
    });
  };

  const replyFields = (m: ClientMessage | undefined) =>
    m ? { replyToId: m.id, replyTo: previewOf(m) } : { replyToId: undefined, replyTo: null };

  const send = () => {
    const encoded = encodeMentions(text, refs.current).trim();
    if (editing) {
      void saveEdit(chat, editing, encoded).then((ok) => {
        if (ok) {
          stash.current = null;
          setText('');
          refs.current = [];
          useConversationUi.getState().setEditing(chat.id, null);
        }
      });
      return;
    }
    if (!encoded) return;
    if (encoded.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Messages can be up to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters`);
      return;
    }
    const r = replyFields(reply);
    clearAfterSend();
    if (sounds) playSound('sent');
    void sendQueued(
      chat.id,
      { type: 'text', text: encoded, replyToId: r.replyToId },
      { optimistic: r.replyTo ? { replyTo: r.replyTo } : undefined },
    );
  };

  const cancelEdit = () => useConversationUi.getState().setEditing(chat.id, null);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setMentionIdx((i) => (i + d + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(suggestions[mentionIdx] ?? suggestions[0]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && enterToSend && !touch) {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === 'Escape') {
      if (editing) cancelEdit();
      else if (emojiOpen) setEmojiOpen(false);
      else if (reply) useConversationUi.getState().setReply(chat.id, null);
      else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // ↑ in an empty field edits your last message (WhatsApp Web).
    if (e.key === 'ArrowUp' && !text && !editing) {
      const items = useMessages.getState().byChat[chat.id]?.items ?? [];
      for (let i = items.length - 1; i >= 0; i--) {
        const m = items[i]!;
        if (m.senderId !== meId || m.type === 'system') continue;
        if (canEdit(chat, m)) {
          e.preventDefault();
          useConversationUi.getState().setEditing(chat.id, m);
        }
        break;
      }
    }
  };

  // ---- files -------------------------------------------------------------

  const tooBig = (files: File[]) => {
    const big = files.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (big) toast.error(`“${big.name}” is larger than ${formatBytes(MAX_UPLOAD_BYTES)}`);
    return files.filter((f) => f.size <= MAX_UPLOAD_BYTES);
  };

  const sendVisual = async (items: { file: File; caption: string }[]) => {
    setPreview(null);
    const r = replyFields(reply);
    const captions = items.map((it) => encodeMentions(it.caption, refs.current));
    clearAfterSend();
    const prepared = await Promise.all(
      items.map(async (it, i) => {
        try {
          return { ...(await prepareVisualMedia(it.file)), caption: captions[i] };
        } catch {
          toast.error(`Couldn’t process “${it.file.name}”`);
          return null;
        }
      }),
    );
    const jobs = prepared
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p, i) =>
        enqueueMedia(chat.id, {
          ...p,
          ...(i === 0 ? r : {}),
          caption: p.caption,
        }),
      );
    for (const job of jobs) await job();
  };

  const sendFiles = async (files: File[], kind: 'file' | 'audio') => {
    const list = tooBig(files);
    if (!list.length) return;
    if (
      list.length > 1 &&
      !(await confirm({ title: `Send ${list.length} files?`, confirmLabel: 'Send' }))
    )
      return;
    const r = replyFields(reply);
    clearAfterAttachmentSend();
    const jobs: (() => Promise<void>)[] = [];
    for (const [i, f] of list.entries()) {
      const durationMs =
        kind === 'audio' ? await readAudioDuration(f).catch(() => undefined) : undefined;
      jobs.push(
        enqueueMedia(chat.id, {
          kind,
          blob: f,
          fileName: f.name,
          mimeType: f.type || 'application/octet-stream',
          durationMs,
          ...(i === 0 ? r : {}),
        }),
      );
    }
    for (const job of jobs) await job();
  };

  const handleFiles = (files: File[]) => {
    const list = tooBig(files);
    if (!list.length) return;
    const visual = list.filter(isVisualMedia);
    const other = list.filter((f) => !isVisualMedia(f));
    if (visual.length) setPreview(visual);
    if (other.length) void sendFiles(other, 'file');
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (!files.length) return;
    e.preventDefault();
    handleFiles(files);
  };

  const onAttach = (kind: AttachKind) => {
    if (kind === 'media') mediaInput.current?.click();
    else if (kind === 'document') docInput.current?.click();
    else if (kind === 'audio') audioInput.current?.click();
    else setDialog(kind);
  };

  // ---- voice notes -------------------------------------------------------

  const startRecording = async (locked: boolean) => {
    if (!recordingSupported()) {
      toast.error('Voice messages aren’t supported in this browser');
      return;
    }
    setStarting(true);
    try {
      const rec = await VoiceRecording.start();
      if (!locked && !hold.current) {
        // Released before the microphone was ready: treat as a tap (locked recording).
        locked = true;
      }
      setVoice({ rec, locked });
      typing.recording(true);
    } catch (e) {
      toast.error(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Allow microphone access to record voice messages'
          : 'Couldn’t start recording',
      );
    } finally {
      setStarting(false);
    }
  };

  const cancelRecording = () => {
    voiceRef.current?.rec.cancel();
    setVoice(null);
    typing.recording(false);
  };

  const finishRecording = async () => {
    const v = voiceRef.current;
    if (!v) return;
    setVoice(null);
    typing.recording(false);
    try {
      const res = await v.rec.stop();
      if (res.durationMs < 800) {
        toast.info('Hold to record, release to send', { id: 'voice-short' });
        return;
      }
      const r = replyFields(useConversationUi.getState().reply[chat.id]);
      useConversationUi.getState().setReply(chat.id, null);
      useConversationUi.getState().requestBottom();
      if (sounds) playSound('sent');
      await sendMedia(chat.id, {
        kind: 'voice',
        blob: res.blob,
        fileName: res.fileName,
        mimeType: res.mimeType,
        durationMs: res.durationMs,
        waveform: res.waveform,
        ...r,
      });
    } catch (e) {
      toast.error(e);
    }
  };

  const onMicDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (voice || starting || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const h = {
      timer: null as ReturnType<typeof setTimeout> | null,
      x: e.clientX,
      y: e.clientY,
      started: false,
    };
    h.timer = setTimeout(() => {
      h.timer = null;
      h.started = true;
      void startRecording(false);
    }, HOLD_MS);
    hold.current = h;
  };
  const onMicMove = (e: PointerEvent<HTMLButtonElement>) => {
    const h = hold.current;
    const v = voiceRef.current;
    if (!h || !v || v.locked) return;
    if (e.clientX - h.x < -90) {
      hold.current = null;
      cancelRecording();
    } else if (e.clientY - h.y < -70) {
      setVoice({ ...v, locked: true });
    }
  };
  const onMicUp = () => {
    const h = hold.current;
    hold.current = null;
    if (!h) return;
    if (h.timer) {
      // Quick tap → locked recording.
      clearTimeout(h.timer);
      void startRecording(true);
      return;
    }
    const v = voiceRef.current;
    if (v && !v.locked) void finishRecording();
  };

  const hasText = text.trim().length > 0;
  const showSend = hasText || !!editing || (voice?.locked ?? false);

  return (
    <div
      className="relative shrink-0 border-t border-line bg-surface px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] sm:px-3"
      data-testid="composer"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        e.preventDefault();
        handleFiles(files);
      }}
    >
      {dragOver ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-t-2xl border-2 border-dashed border-brand bg-brand-soft/90 text-sm font-semibold text-brand-ink">
          Drop files to send
        </div>
      ) : null}

      {suggestions.length ? (
        <MentionSuggestions
          id={listId}
          users={suggestions}
          active={mentionIdx}
          onPick={pickMention}
          onHover={setMentionIdx}
        />
      ) : null}

      {editing ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface-2 py-1.5 pr-1 pl-3 animate-slide-down">
          <Pencil size={16} className="shrink-0 text-brand-ink" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-brand-ink">Edit message</p>
            <p className="truncate text-[13px] text-muted">
              {decodeMentions(editing.text ?? '', mentionName).text}
            </p>
          </div>
          <IconButton icon={X} label="Cancel editing" size="sm" onClick={cancelEdit} />
        </div>
      ) : reply ? (
        <div className="mb-2 flex items-center gap-1 animate-slide-down">
          <ReplyQuote preview={previewOf(reply)} chatId={chat.id} className="flex-1" />
          <IconButton
            icon={X}
            label="Cancel reply"
            size="sm"
            onClick={() => useConversationUi.getState().setReply(chat.id, null)}
          />
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        {voice ? (
          <VoiceRecorderBar rec={voice.rec} locked={voice.locked} onCancel={cancelRecording} />
        ) : (
          <div className="flex min-h-12 min-w-0 flex-1 items-end rounded-3xl bg-surface-2 transition-shadow focus-within:ring-2 focus-within:ring-brand/25">
            <IconButton
              icon={emojiOpen ? Keyboard : Smile}
              label={emojiOpen ? 'Hide emoji' : 'Emoji'}
              active={emojiOpen}
              onClick={() => {
                setEmojiOpen((o) => !o);
                if (emojiOpen) ta.current?.focus();
              }}
              className="m-1 shrink-0"
            />
            <textarea
              ref={ta}
              value={text}
              rows={1}
              onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
              onKeyDown={onKeyDown}
              onKeyUp={(e) => updateMention(e.currentTarget.value, e.currentTarget.selectionStart)}
              onClick={(e) => updateMention(e.currentTarget.value, e.currentTarget.selectionStart)}
              onBlur={() => {
                typing.stop();
                setTimeout(() => setMention(null), 150);
              }}
              onPaste={onPaste}
              placeholder={editing ? 'Edit message' : 'Message'}
              aria-label="Message"
              aria-autocomplete={chat.type === 'group' ? 'list' : undefined}
              aria-controls={suggestions.length ? listId : undefined}
              aria-activedescendant={suggestions.length ? `${listId}-${mentionIdx}` : undefined}
              enterKeyHint={enterToSend && !touch ? 'send' : 'enter'}
              className="max-h-40 min-h-12 min-w-0 flex-1 resize-none bg-transparent py-3 text-chat leading-[1.35] text-fg outline-none placeholder:text-subtle"
            />
            <IconButton
              icon={Paperclip}
              label="Attach"
              aria-haspopup="menu"
              active={!!attachAnchor}
              onClick={(e) => setAttachAnchor(attachAnchor ? null : e.currentTarget)}
              className="m-1 shrink-0"
            />
            {!hasText && !editing ? (
              <IconButton
                icon={Camera}
                label="Camera"
                onClick={() => setDialog('camera')}
                className="m-1 ml-0 shrink-0 sm:hidden"
              />
            ) : null}
          </div>
        )}

        {showSend ? (
          <IconButton
            icon={editing ? Check : SendHorizontal}
            label={editing ? 'Save edit' : 'Send'}
            variant="brand"
            size="lg"
            ref={sendButton}
            onClick={(e) => {
              keepFocus(e.currentTarget);
              if (voice) void finishRecording();
              else send();
            }}
            className="mb-0 shrink-0 animate-pop"
          />
        ) : (
          <button
            type="button"
            aria-label={voice ? 'Recording… release to send' : 'Record voice message'}
            title="Tap to record, or hold to talk"
            onPointerDown={onMicDown}
            onPointerMove={onMicMove}
            onPointerUp={onMicUp}
            onPointerCancel={() => {
              hold.current = null;
              if (voiceRef.current && !voiceRef.current.locked) cancelRecording();
            }}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !voice) {
                e.preventDefault();
                // The mic is swapped for the recorder's Send button: keep keyboard focus.
                void startRecording(true).then(() =>
                  requestAnimationFrame(() => sendButton.current?.focus()),
                );
              }
            }}
            className={cn(
              'flex size-12 shrink-0 touch-none items-center justify-center rounded-full bg-brand text-on-brand shadow-sm transition-transform select-none hover:bg-brand-strong',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              voice && !voice.locked && 'scale-125 bg-danger',
            )}
          >
            {starting ? <Spinner size={20} label={null} /> : <Mic size={22} aria-hidden />}
          </button>
        )}
      </div>

      {emojiOpen && !voice ? (
        <div className="-mx-2 mt-2 h-[min(300px,40dvh)] overflow-hidden border-t border-line sm:-mx-3 sm:h-[min(340px,42dvh)]">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-brand-ink">
                <Spinner />
              </div>
            }
          >
            <LazyEmojiPicker height="100%" onPick={insertAtCaret} />
          </Suspense>
        </div>
      ) : null}

      <AttachMenu anchor={attachAnchor} onClose={() => setAttachAnchor(null)} onPick={onAttach} />
      <input
        ref={mediaInput}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          const files = tooBig(Array.from(e.target.files ?? []));
          e.target.value = '';
          if (files.length) setPreview(files);
        }}
      />
      <input
        ref={docInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void sendFiles(files, 'file');
        }}
      />
      <input
        ref={audioInput}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void sendFiles(files, 'audio');
        }}
      />

      {preview ? (
        <MediaPreviewDialog
          chat={chat}
          files={preview}
          initialCaption={text}
          onClose={() => setPreview(null)}
          onSend={(items) => void sendVisual(items)}
        />
      ) : null}
      <LocationDialog
        open={dialog === 'location'}
        onClose={() => setDialog(null)}
        onSend={(location) => {
          setDialog(null);
          const r = replyFields(reply);
          clearAfterAttachmentSend();
          void sendQueued(
            chat.id,
            { type: 'location', location, replyToId: r.replyToId },
            { optimistic: r.replyTo ? { replyTo: r.replyTo } : undefined },
          );
        }}
      />
      <ContactPickerDialog
        open={dialog === 'contact'}
        onClose={() => setDialog(null)}
        onSend={(c) => {
          setDialog(null);
          const r = replyFields(reply);
          clearAfterAttachmentSend();
          void sendQueued(
            chat.id,
            { type: 'contact', contact: { userId: c.user.id }, replyToId: r.replyToId },
            {
              optimistic: {
                contact: {
                  userId: c.user.id,
                  name: c.name ?? userDisplayName(c.user),
                  username: c.user.username,
                  phone: c.user.phone,
                },
                replyTo: r.replyTo,
              },
            },
          );
        }}
      />
      <PollDialog
        open={dialog === 'poll'}
        onClose={() => setDialog(null)}
        onSend={(poll) => {
          setDialog(null);
          const r = replyFields(reply);
          clearAfterAttachmentSend();
          void sendQueued(
            chat.id,
            { type: 'poll', poll, replyToId: r.replyToId },
            { optimistic: r.replyTo ? { replyTo: r.replyTo } : undefined },
          );
        }}
      />
      <CameraDialog
        open={dialog === 'camera'}
        onClose={() => setDialog(null)}
        onCapture={(file) => {
          setDialog(null);
          setPreview([file]);
        }}
      />
    </div>
  );
}
