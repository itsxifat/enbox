/**
 * Message composer (web features/conversation/composer/Composer.tsx): auto-growing field,
 * emoji panel, typing/recording indicators, @mention suggestions in groups, reply/edit
 * banners, drafts, attachments (photos & videos with preview + captions, camera, documents,
 * audio, location, contact, poll) and voice notes (tap to record locked, or hold: release
 * sends, slide left cancels, slide up locks).
 *
 * Emoji panel ⇄ keyboard (the app's fix for the web picker, which on phones opened on top
 * of the soft keyboard in a fixed-size box): the panel *replaces* the keyboard at the
 * keyboard's own height. While it shows, the screen stops avoiding the keyboard
 * (`onAvoidKeyboard(false)`) so the conversation never jumps when switching; the keyboard
 * icon brings the keyboard back and the panel leaves once the keyboard is fully up.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, TextInput, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardController, KeyboardEvents } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  Check,
  Keyboard as KeyboardIcon,
  Mic,
  Paperclip,
  Pencil,
  Smile,
  X,
} from 'lucide-react-native';
import { MAX_MESSAGE_LENGTH, MAX_UPLOAD_BYTES, formatBytes, userDisplayName } from '@enbox/shared';
import { ICON_STROKE_ON_FILL, Icon, SendIcon } from '@/components/icons';
import { IconButton, Spinner, T, confirm, toast, useBackHandler } from '@/components/ui';
import { playSound } from '@/lib/notify';
import { useAuth } from '@/stores/auth';
import { useMessages } from '@/stores/messages';
import { useUi } from '@/stores/ui';
import { mentionName } from '@/features/chats/preview';
import { getDraft, useDrafts } from '@/features/chats/drafts';
import { EmojiPanel } from '@/features/emoji/EmojiPanel';
import { alpha, useTheme } from '@/theme';
import { canEdit, previewOf, saveEdit } from '../actions';
import { ReplyQuote } from '../bubbles/Quote';
import {
  activeMentionQuery,
  decodeMentions,
  encodeMentions,
  insertMention,
  matchesMentionQuery,
  pruneRefs,
} from '../lib/composerMentions';
import { pickDocuments, pickMedia, prepareEach, takeWithCamera } from '../lib/mediaProcessing';
import { sendQueued } from '../lib/outbox';
import { useVoiceRecorder } from '../lib/recorder';
import { enqueueMedia, sendMedia } from '../lib/sendMedia';
import { createTypingEmitter } from '../lib/typing';
import { useChatMembers } from '../members';
import { useConversationUi } from '../state';
import { ContactPickerDialog, LocationDialog, PollDialog } from './AttachDialogs';
import { MediaPreview } from './MediaPreview';
import { AttachMenu, MentionSuggestions, VoiceRecorderBar } from './parts';

const MAX_ROWS = 6;
const HOLD_MS = 220;
const LINE = 20.7;

/** Remove the grapheme before `at` (emoji sequences count as one). */
function deleteBefore(text, at) {
  const head = text.slice(0, at);
  if (!head) return { text, caret: at };
  let cut;
  const Seg = typeof Intl !== 'undefined' ? Intl.Segmenter : undefined;
  if (Seg) {
    const parts = Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(head));
    cut = head.length - (parts[parts.length - 1]?.segment.length ?? 1);
  } else {
    const m =
      /(?:\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*|\p{Regional_Indicator}{2}|[\s\S])$/u.exec(
        head,
      );
    cut = head.length - (m ? m[0].length : 1);
  }
  return { text: head.slice(0, cut) + text.slice(at), caret: cut };
}

export function Composer({ chat, onAvoidKeyboard }) {
  const { tw, c, shadow, chatFontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const meId = useAuth((s) => s.user?.id);
  const sounds = useUi((s) => s.prefs.sounds);
  const reply = useConversationUi((s) => s.reply[chat.id]);
  const editing = useConversationUi((s) => s.editing[chat.id]);
  const focusToken = useConversationUi((s) => s.focusToken);
  const members = useChatMembers(chat);

  const initial = useMemo(() => {
    const d = getDraft(chat.id);
    return d ? decodeMentions(d.text, mentionName) : { text: '', refs: [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [text, setText] = useState(initial.text);
  const refs = useRef(initial.refs);
  const selection = useRef({ start: initial.text.length, end: initial.text.length });
  const [forcedSel, setForcedSel] = useState(undefined);
  const [mention, setMention] = useState(null);
  const [panel, setPanel] = useState('none'); // 'none' | 'emoji' | 'keyboard' (switching back)
  const [emojiSearch, setEmojiSearch] = useState(false);
  const [keyboardShown, setKeyboardShown] = useState(false);
  const [kbHeight, setKbHeight] = useState(() => Math.round(windowHeight * 0.38));
  const [attachOpen, setAttachOpen] = useState(false);
  const [composerTop, setComposerTop] = useState(120);
  const [dialog, setDialog] = useState(null);
  const [preview, setPreview] = useState(null);
  const [voice, setVoice] = useState(null); // { locked }
  const [starting, setStarting] = useState(false);
  const input = useRef(null);
  const card = useRef(null);
  const stash = useRef(null);
  const hold = useRef(null);
  const rec = useVoiceRecorder();
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const typing = useMemo(() => createTypingEmitter(chat.id), [chat.id]);
  useEffect(() => () => typing.dispose(), [typing]);
  useEffect(() => () => rec.cancel(), [rec]);

  // ---- keyboard ⇄ emoji panel ------------------------------------------------

  useEffect(() => {
    const show = KeyboardEvents.addListener('keyboardDidShow', (e) => {
      if (e.height > 120) setKbHeight(Math.round(e.height));
      setKeyboardShown(true);
      // The keyboard is fully up: the panel can leave (it was covering the same area).
      setPanel((p) => (p === 'none' || emojiSearchRef.current ? p : 'none'));
    });
    const hide = KeyboardEvents.addListener('keyboardDidHide', () => setKeyboardShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const emojiSearchRef = useRef(false);
  emojiSearchRef.current = emojiSearch;

  const panelShown = panel === 'emoji' || panel === 'keyboard';
  useEffect(() => {
    // Avoid the keyboard unless the panel stands in for it (emoji search needs the keyboard).
    onAvoidKeyboard?.(!panelShown || emojiSearch);
  }, [panelShown, emojiSearch, onAvoidKeyboard]);

  const openEmoji = () => {
    setPanel('emoji');
    setAttachOpen(false);
    if (keyboardShown) KeyboardController.dismiss().catch(() => Keyboard.dismiss());
  };
  const openKeyboard = () => {
    setPanel('keyboard');
    setEmojiSearch(false);
    input.current?.focus();
    // No keyboard event (web preview, hardware keyboard): don't keep the panel forever.
    setTimeout(() => setPanel((p) => (p === 'keyboard' ? 'none' : p)), 700);
  };
  useBackHandler(() => {
    if (emojiSearch) {
      setEmojiSearch(false);
      Keyboard.dismiss();
      return true;
    }
    setPanel('none');
    return true;
  }, panelShown);

  // ---- drafts / edit / reply -------------------------------------------------

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

  useEffect(() => {
    if (editing) return;
    useDrafts.getState().setDraft(chat.id, encodeMentions(text, refs.current), reply?.id ?? null);
  }, [text, reply?.id, editing, chat.id]);

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
    setTimeout(() => input.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, chat.id]);

  const firstFocus = useRef(focusToken);
  useEffect(() => {
    if (firstFocus.current === focusToken) return;
    if (panel !== 'emoji') input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  // ---- text & mentions -------------------------------------------------------

  const suggestions = useMemo(() => {
    if (!mention || chat.type !== 'group' || !members) return [];
    return members
      .map((mm) => mm.user)
      .filter(
        (u) =>
          u.id !== meId && !u.isDeleted && matchesMentionQuery(userDisplayName(u), mention.query),
      )
      .slice(0, 8);
  }, [mention, chat.type, members, meId]);

  const updateMention = (value, caret) => {
    if (chat.type !== 'group') return;
    setMention(activeMentionQuery(value, caret));
  };

  const onChangeText = (value) => {
    setText(value);
    refs.current = pruneRefs(value, refs.current);
    if (value.trim()) typing.keystroke();
    else typing.stop();
    if (forcedSel) setForcedSel(undefined);
  };

  const pickMention = (u) => {
    if (!mention) return;
    const name = userDisplayName(u);
    const res = insertMention(text, mention, selection.current.start, name);
    refs.current = [...refs.current.filter((r) => r.userId !== u.id), { userId: u.id, name }];
    setText(res.text);
    setMention(null);
    setForcedSel({ start: res.caret, end: res.caret });
  };

  const insertAtCaret = (s) => {
    const { start, end } = selection.current;
    const a = Math.min(start, text.length);
    const b = Math.min(end, text.length);
    const next = text.slice(0, a) + s + text.slice(b);
    setText(next);
    selection.current = { start: a + s.length, end: a + s.length };
    setForcedSel({ start: a + s.length, end: a + s.length });
    typing.keystroke();
  };

  const backspace = () => {
    const { start, end } = selection.current;
    if (start !== end) {
      setText(text.slice(0, start) + text.slice(end));
      selection.current = { start, end: start };
      setForcedSel({ start, end: start });
      return;
    }
    const res = deleteBefore(text, Math.min(start, text.length));
    setText(res.text);
    refs.current = pruneRefs(res.text, refs.current);
    selection.current = { start: res.caret, end: res.caret };
    setForcedSel({ start: res.caret, end: res.caret });
  };

  // ---- sending ---------------------------------------------------------------

  const replyFields = (m) =>
    m ? { replyToId: m.id, replyTo: previewOf(m) } : { replyToId: undefined, replyTo: null };

  const clearAfterAttachmentSend = () => {
    setMention(null);
    useConversationUi.getState().setReply(chat.id, null);
    typing.stop();
    useConversationUi.getState().requestBottom();
  };
  const clearAfterSend = () => {
    setText('');
    refs.current = [];
    selection.current = { start: 0, end: 0 };
    useDrafts.getState().clearDraft(chat.id);
    clearAfterAttachmentSend();
  };

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

  const tooBig = (files) => {
    const big = files.find((f) => (f.size ?? 0) > MAX_UPLOAD_BYTES);
    if (big) toast.error(`“${big.name}” is larger than ${formatBytes(MAX_UPLOAD_BYTES)}`);
    return files.filter((f) => (f.size ?? 0) <= MAX_UPLOAD_BYTES);
  };

  const sendVisual = async (items) => {
    setPreview(null);
    const r = replyFields(reply);
    const captions = items.map((it) => encodeMentions(it.caption, refs.current));
    clearAfterSend();
    let uploads = Promise.resolve();
    let first = true;
    await prepareEach(
      items,
      (p, _item, i) => {
        const job = enqueueMedia(chat.id, { ...p, ...(first ? r : {}), caption: captions[i] });
        first = false;
        uploads = uploads.then(job).catch(() => undefined);
      },
      (item) => toast.error(`Couldn’t process “${item.file.name}”`),
    );
    await uploads;
  };

  const sendFiles = async (files, kind) => {
    const list = tooBig(files);
    if (!list.length) return;
    if (
      list.length > 1 &&
      !(await confirm({ title: `Send ${list.length} files?`, confirmLabel: 'Send' }))
    )
      return;
    const r = replyFields(reply);
    clearAfterAttachmentSend();
    const jobs = list.map((f, i) =>
      enqueueMedia(chat.id, {
        kind,
        blob: f,
        fileName: f.name,
        mimeType: f.type || 'application/octet-stream',
        durationMs: f.durationMs,
        ...(i === 0 ? r : {}),
      }),
    );
    for (const job of jobs) await job();
  };

  const onAttach = async (kind) => {
    try {
      if (kind === 'media') {
        const files = tooBig(await pickMedia());
        if (files.length) setPreview(files);
      } else if (kind === 'camera') {
        const files = tooBig(await takeWithCamera());
        if (files.length) setPreview(files);
      } else if (kind === 'document') {
        void sendFiles(await pickDocuments(), 'file');
      } else if (kind === 'audio') {
        void sendFiles(await pickDocuments({ audio: true }), 'audio');
      } else setDialog(kind);
    } catch (e) {
      toast.error(e);
    }
  };

  // ---- voice notes -------------------------------------------------------------

  const startRecording = async (locked) => {
    setStarting(true);
    try {
      await rec.start();
      if (!locked && !hold.current) locked = true; // released before the mic was ready
      setVoice({ locked });
      typing.recording(true);
      setPanel('none');
    } catch (e) {
      toast.error(
        e?.name === 'NotAllowedError'
          ? 'Allow microphone access to record voice messages'
          : 'Couldn’t start recording',
      );
    } finally {
      setStarting(false);
    }
  };

  const cancelRecording = () => {
    rec.cancel();
    setVoice(null);
    typing.recording(false);
  };

  const finishRecording = async () => {
    if (!voiceRef.current) return;
    setVoice(null);
    typing.recording(false);
    try {
      const res = await rec.stop();
      if (!res || res.durationMs < 800) {
        toast.info('Hold to record, release to send', { id: 'voice-short' });
        return;
      }
      const r = replyFields(useConversationUi.getState().reply[chat.id]);
      useConversationUi.getState().setReply(chat.id, null);
      useConversationUi.getState().requestBottom();
      if (sounds) playSound('sent');
      await sendMedia(chat.id, {
        kind: 'voice',
        blob: res.file,
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

  const onMicBegin = () => {
    if (voiceRef.current || starting) return;
    const h = { timer: null, started: false };
    h.timer = setTimeout(() => {
      h.timer = null;
      h.started = true;
      void startRecording(false);
    }, HOLD_MS);
    hold.current = h;
  };
  const onMicMove = (dx, dy) => {
    const v = voiceRef.current;
    if (!hold.current || !v || v.locked) return;
    if (dx < -90) {
      hold.current = null;
      cancelRecording();
    } else if (dy < -70) setVoice({ ...v, locked: true });
  };
  const onMicEnd = () => {
    const h = hold.current;
    hold.current = null;
    if (!h) return;
    if (h.timer) {
      clearTimeout(h.timer);
      void startRecording(true);
      return;
    }
    const v = voiceRef.current;
    if (v && !v.locked) void finishRecording();
  };
  const micGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onBegin(onMicBegin)
    .onUpdate((e) => onMicMove(e.translationX, e.translationY))
    .onFinalize(onMicEnd);

  // ---- layout ------------------------------------------------------------------

  const hasText = text.trim().length > 0;
  const showSend = hasText || !!editing || (voice?.locked ?? false);
  const bottomGap = keyboardShown || panelShown ? 8 : Math.max(8, insets.bottom);
  const fieldStyle = {
    flex: 1,
    minHeight: 48,
    maxHeight: LINE * MAX_ROWS + 24,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: chatFontSize,
    lineHeight: Math.round(chatFontSize * 1.35),
    color: c.fg,
    textAlignVertical: 'center',
  };

  return (
    <View>
      <View
        ref={card}
        onLayout={() =>
          card.current?.measureInWindow?.((_x, y) => {
            if (Number.isFinite(y)) setComposerTop(y);
          })
        }
        style={[
          tw`relative mx-2 mt-2 rounded-xl bg-surface-2 px-2 py-2`,
          shadow.bubble,
          { marginBottom: bottomGap },
        ]}
      >
        <MentionSuggestions users={suggestions} onPick={pickMention} />

        {editing ? (
          <View
            style={tw`mb-2 flex-row items-center gap-2 rounded-xl bg-surface-2 py-1.5 pr-1 pl-3`}
          >
            <Icon icon={Pencil} size={16} color={c['brand-ink']} />
            <View style={tw`min-w-0 flex-1`}>
              <T style={tw`text-[13px] font-semibold text-brand-ink`}>Edit message</T>
              <T numberOfLines={1} style={tw`text-[13px] text-muted`}>
                {decodeMentions(editing.text ?? '', mentionName).text}
              </T>
            </View>
            <IconButton icon={X} label="Cancel editing" size="sm" onPress={cancelEdit} />
          </View>
        ) : reply ? (
          <View style={tw`mb-2 flex-row items-center gap-1`}>
            <View style={tw`min-w-0 flex-1`}>
              <ReplyQuote preview={previewOf(reply)} chatId={chat.id} />
            </View>
            <IconButton
              icon={X}
              label="Cancel reply"
              size="sm"
              onPress={() => useConversationUi.getState().setReply(chat.id, null)}
            />
          </View>
        ) : null}

        <View style={tw`flex-row items-end gap-2`}>
          {voice ? (
            <VoiceRecorderBar
              elapsedMs={rec.elapsedMs}
              levels={rec.levels}
              locked={voice.locked}
              onCancel={cancelRecording}
            />
          ) : (
            <View
              style={[
                tw`min-h-12 min-w-0 flex-1 flex-row items-end rounded-3xl bg-surface-2`,
                { borderWidth: 1, borderColor: 'transparent' },
              ]}
            >
              <IconButton
                icon={panelShown && !emojiSearch ? KeyboardIcon : Smile}
                label={panelShown ? 'Show keyboard' : 'Emoji'}
                active={panelShown}
                onPress={panelShown ? openKeyboard : openEmoji}
                style={tw`m-1`}
              />
              <TextInput
                ref={input}
                value={text}
                multiline
                onChangeText={onChangeText}
                selection={forcedSel}
                onSelectionChange={(e) => {
                  selection.current = e.nativeEvent.selection;
                  updateMention(text, e.nativeEvent.selection.start);
                  if (forcedSel) setForcedSel(undefined);
                }}
                onFocus={() => {
                  if (panel === 'emoji') setPanel('keyboard');
                }}
                onBlur={() => {
                  typing.stop();
                  setTimeout(() => setMention(null), 150);
                }}
                placeholder={editing ? 'Edit message' : 'Message'}
                placeholderTextColor={c.subtle}
                selectionColor={alpha(c.brand, 0.5)}
                cursorColor={c.brand}
                style={fieldStyle}
                accessibilityLabel="Message"
                showSoftInputOnFocus
                autoCorrect
                {...(Platform.OS === 'web' ? { rows: 1 } : null)}
              />
              <IconButton
                icon={Paperclip}
                label="Attach"
                active={attachOpen}
                onPress={() => {
                  if (!attachOpen) Keyboard.dismiss();
                  setAttachOpen((o) => !o);
                }}
                style={tw`m-1`}
              />
              {!hasText && !editing ? (
                <IconButton
                  icon={Camera}
                  label="Camera"
                  onPress={() => void onAttach('camera')}
                  style={[tw`m-1`, { marginLeft: 0 }]}
                />
              ) : null}
            </View>
          )}

          {showSend ? (
            <IconButton
              icon={editing ? Check : SendIcon}
              label={editing ? 'Save edit' : 'Send'}
              variant="brand"
              size="lg"
              onPress={() => {
                if (voice) void finishRecording();
                else send();
              }}
            />
          ) : (
            <GestureDetector gesture={micGesture}>
              <View
                accessibilityRole="button"
                accessibilityLabel={voice ? 'Recording… release to send' : 'Record voice message'}
                style={[
                  tw`size-12 items-center justify-center rounded-full`,
                  shadow.sm,
                  {
                    backgroundColor: voice && !voice.locked ? c.danger : c.brand,
                    transform: [{ scale: voice && !voice.locked ? 1.25 : 1 }],
                  },
                ]}
              >
                {starting ? (
                  <Spinner size={20} color="#fff" />
                ) : (
                  <Icon
                    icon={Mic}
                    size={24}
                    strokeWidth={ICON_STROKE_ON_FILL}
                    color={c['on-brand']}
                  />
                )}
              </View>
            </GestureDetector>
          )}
        </View>
      </View>

      {panelShown && !voice ? (
        <EmojiPanel
          height={kbHeight}
          searching={emojiSearch}
          onPick={insertAtCaret}
          onBackspace={backspace}
          onSearchFocus={setEmojiSearch}
        />
      ) : null}

      <AttachMenu
        open={attachOpen}
        bottom={Math.max(8, windowHeight - composerTop + 6 - (Platform.OS === 'web' ? 0 : 0))}
        onClose={() => setAttachOpen(false)}
        onPick={(kind) => void onAttach(kind)}
      />

      {preview ? (
        <MediaPreview
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
        onSend={(ct) => {
          setDialog(null);
          const r = replyFields(reply);
          clearAfterAttachmentSend();
          void sendQueued(
            chat.id,
            { type: 'contact', contact: { userId: ct.user.id }, replyToId: r.replyToId },
            {
              optimistic: {
                contact: {
                  userId: ct.user.id,
                  name: ct.name ?? userDisplayName(ct.user),
                  username: ct.user.username,
                  phone: ct.user.phone,
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
    </View>
  );
}

export { canEdit };
