/**
 * Message composer: auto-growing text field, emoji picker (lazy), Enter-to-send (device
 * preference; touch keyboards insert newlines), typing/recording indicators, @mention
 * suggestions in groups, reply/edit banners, drafts, attachments (location, contact, poll,
 * camera) and voice notes (tap to record locked, or hold: release sends, slide left cancels,
 * slide up locks).
 *
 * Files (paste, drop anywhere over the conversation — see dropzone/ — and "+" picks) wait
 * in the attachment tray and go with the next send as ONE message (Discord: up to
 * MAX_ATTACHMENTS, the text its caption, alt text per photo): every file uploads with its
 * progress on its tile, then the message is sent; a failed upload keeps the tray (Retry).
 * A Shift-drop sends right away. Phones keep the full-screen preview with a caption for
 * photo/video picks and the camera. Space channels need ATTACH_FILES for any of it.
 *
 * Formatting (formatting/): Ctrl/Cmd+B, I, U and Shift+X wrap or unwrap the selection (or put
 * markers around the caret; Ctrl/Cmd+I in an empty box stays the Inbox's), and selecting text
 * on desktop floats a toolbar over it (Alt+F10 reaches it). Edits keep the undo stack.
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
import { Check, Mic, Pencil, PlusCircle, Smile, X, Camera, Keyboard } from 'lucide-react';
import {
  isVoiceChannelType,
  MAX_CAPTION_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_UPLOAD_BYTES,
  formatBytes,
  userDisplayName,
  type ChatSummary,
} from '@enbox/shared';
import { SendIcon } from '@/components/icons';
import { IconButton, Spinner } from '@/components/ui';
import { useBus } from '@/hooks/useBus';
import { useIsDesktop, useIsTouch } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { playSound } from '@/lib/notify';
import { useAuth } from '@/stores/auth';
import { useMessages, type ClientMessage } from '@/stores/messages';
import { toast, useUi } from '@/stores/ui';
import { mentionName } from '@/features/chats/preview';
import { getDraft, useDrafts } from '@/features/chats/drafts';
import { useSpaceMentionCandidates, type MentionCandidate } from '@/features/spaces/mentions';
import { AutoModBlockedNotice } from '@/features/spaces/automod/AutoModBlockedNotice';
import { StickerButton } from '@/features/stickers/StickerButton';
import { sendSticker } from '@/features/stickers/send';
import { useSpaces } from '@/stores/spaces';
import { canEdit, previewOf, saveEdit } from '../actions';
import { ReplyQuote } from '../bubbles/Quote';
import { useChatTitle } from '@/features/groupDms/title';
import { LazyEmojiPicker } from '../lazy';
import {
  activeMentionQuery,
  decodeMentions,
  encodeMentions,
  insertMention,
  matchesMentionQuery,
  pickEmoji,
  pruneRefs,
  type MentionQuery,
  type MentionRef,
} from '../lib/composerMentions';
import {
  MAX_ATTACHMENTS,
  NO_UPLOAD_PERMISSION,
  TOO_MANY_ATTACHMENTS,
  canAttachFiles,
} from '../dropzone/files';
import { VoiceRecording, recordingSupported } from '../lib/recorder';
import { sendAttachments, sendMedia, uploadAll, type AttachmentLead } from '../lib/sendMedia';
import { sendQueued } from '../lib/outbox';
import { createTypingEmitter } from '../lib/typing';
import { useChatMembers } from '../members';
import { useConversationUi } from '../state';
import { applyCommand, commandQuery, matchCommands, type SlashCommand } from '../commands/commands';
import { CommandSuggestions } from '../commands/CommandSuggestions';
import { AttachMenu, type AttachKind } from './AttachMenu';
import {
  AttachmentTray,
  trayFile,
  trayItem,
  type TrayEdit,
  type TrayItem,
  type TrayStatus,
  type TrayUpload,
} from './AttachmentTray';
import { CameraDialog, ContactPickerDialog, LocationDialog, PollDialog } from './AttachDialogs';
import { applyTextEdit } from './formatting/applyEdit';
import { FormattingToolbar, type ToolbarFormat } from './formatting/FormattingToolbar';
import { makeLink, toggleInline, toggleQuote, type TextEdit } from './formatting/markdown';
import { shortcutFormat } from './formatting/shortcuts';
import { MediaPreviewDialog } from './MediaPreviewDialog';
import { MentionSuggestions } from './MentionSuggestions';
import { VoiceRecorderBar } from './VoiceRecorderBar';

const MAX_ROWS = 6;
const HOLD_MS = 220;
const NO_COMMANDS: SlashCommand[] = [];

type Dialog = 'location' | 'contact' | 'poll' | 'camera' | null;

/** What goes with the tray's files: the caption and the reply. */
type Lead = AttachmentLead;

/** Files can't be added while the tray's files are being sent. */
const TRAY_BUSY = 'Wait until your files are sent';

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
  const showSendPref = useUi((s) => s.prefs.showSendButton);
  const sounds = useUi((s) => s.prefs.sounds);
  const touch = useIsTouch();
  const desktop = useIsDesktop();
  const reply = useConversationUi((s) => s.reply[chat.id]);
  const editing = useConversationUi((s) => s.editing[chat.id]);
  const focusToken = useConversationUi((s) => s.focusToken);
  const members = useChatMembers(chat);
  // Unnamed group DMs: their members' names.
  const title = useChatTitle(chat);
  const listId = useId();
  const isSpace = !!chat.space; // text channels, threads and voice / Stage chats
  const mentionable = chat.type === 'group' || isSpace;
  const roleName = (id: string) =>
    useSpaces.getState().byId[chat.space?.spaceId ?? '']?.roles.find((r) => r.id === id)?.name ??
    'role';

  const initial = useMemo(() => {
    const d = getDraft(chat.id);
    return d
      ? decodeMentions(d.text, mentionName, roleName)
      : { text: '', refs: [] as MentionRef[] };
    // Only on mount for this chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [text, setText] = useState(initial.text);
  const refs = useRef<MentionRef[]>(initial.refs);
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  // Slash commands: listed while a command name is typed at the start (Escape hides the list
  // until the text changes).
  const [cmdIdx, setCmdIdx] = useState(0);
  const [cmdDismissed, setCmdDismissed] = useState<string | null>(null);
  const cmdListId = useId();
  // Replies: Discord's "@ ON / @ OFF" — the reply whose author is not mentioned (back to ON
  // once the reply is sent or cancelled).
  const [pingOff, setPingOff] = useState<string | null>(null);
  const replyId = reply?.id;
  useEffect(() => {
    if (!replyId) setPingOff(null);
  }, [replyId]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachAnchor, setAttachAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [preview, setPreview] = useState<File[] | null>(null);
  const [voice, setVoice] = useState<{ rec: VoiceRecording; locked: boolean } | null>(null);
  const [starting, setStarting] = useState(false);
  // The ref is the source of truth (several adds can land before a render); state renders it.
  const [tray, setTrayState] = useState<TrayItem[]>([]);
  const trayRef = useRef(tray);
  const setTray = (next: TrayItem[]) => {
    trayRef.current = next;
    setTrayState(next);
  };
  // The tray's send in flight: its files upload (progress on their tiles), then go as one
  // message with the caption and reply it started with — held here, the field is free for the
  // next message meanwhile. Set while `trayStatus` is 'sending'.
  const [trayStatus, setTrayStatus] = useState<TrayStatus>('idle');
  const batch = useRef<{ lead: Lead; controller: AbortController } | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const canAttach = canAttachFiles(chat);
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
  // The formatting toolbar's selection (null = hidden), and one closed with Escape.
  const [fmt, setFmt] = useState<{ start: number; end: number } | null>(null);
  const fmtBar = useRef<HTMLDivElement>(null);
  const fmtClosed = useRef<string | null>(null);
  const fmtApplying = useRef(false);

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
    setFmt(null);
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
    const decoded = decodeMentions(m.text ?? '', mentionName, roleName);
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

  const spaceSuggestions = useSpaceMentionCandidates(
    chat,
    isSpace && mention ? mention.query : null,
    meId,
  );
  const groupSuggestions = useMemo<MentionCandidate[]>(() => {
    if (!mention || chat.type !== 'group' || !members) return [];
    return members
      .map((mm) => mm.user)
      .filter(
        (u) =>
          u.id !== meId && !u.isDeleted && matchesMentionQuery(userDisplayName(u), mention.query),
      )
      .slice(0, 8)
      .map((u) => ({
        key: u.id,
        token: u.id,
        name: userDisplayName(u),
        sub: `@${u.username}`,
        user: u,
      }));
  }, [mention, chat.type, members, meId]);
  const suggestions = isSpace ? spaceSuggestions : groupSuggestions;
  const cmdQuery = editing ? null : commandQuery(text);
  const commands =
    cmdQuery !== null && cmdDismissed !== text ? matchCommands(cmdQuery, chat) : NO_COMMANDS;
  const cmdActive = Math.min(cmdIdx, Math.max(0, commands.length - 1));

  const pickCommand = (c: SlashCommand) => {
    const el = ta.current;
    const next = `/${c.name} `;
    setText(next);
    setCmdIdx(0);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
    });
  };

  /** Replies in groups and Space channels mention the replied author unless "@ OFF". */
  const pingable = (m: ClientMessage | undefined): m is ClientMessage =>
    !!m?.senderId && m.senderId !== meId && (chat.type === 'group' || isSpace);
  const pingFlag = (m: ClientMessage | undefined) =>
    pingable(m) && pingOff === m.id ? { mentionRepliedAuthor: false } : {};

  const updateMention = (value: string, caret: number) => {
    if (!mentionable) return;
    const q = activeMentionQuery(value, caret);
    setMention(q);
    setMentionIdx(0);
  };

  const onChange = (value: string, caret: number) => {
    setText(value);
    // Typing ends the selection; a format applied by the toolbar sets its own.
    if (!fmtApplying.current) setFmt(null);
    setCmdIdx(0);
    if (cmdDismissed !== null && value !== cmdDismissed) setCmdDismissed(null);
    refs.current = pruneRefs(value, refs.current);
    if (value.trim()) typing.keystroke();
    else typing.stop();
    updateMention(value, caret);
  };

  const pickMention = (c: MentionCandidate) => {
    const el = ta.current;
    if (!mention || !el) return;
    const name = c.name;
    const res = insertMention(text, mention, el.selectionStart, name);
    refs.current = [...refs.current.filter((r) => r.userId !== c.token), { userId: c.token, name }];
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

  // ---- formatting --------------------------------------------------------

  /** The toolbar follows the selection (desktop): a range shows it, a caret hides it. */
  const syncFormatBar = (el: HTMLTextAreaElement) => {
    if (touch) return;
    const { selectionStart: start, selectionEnd: end } = el;
    if (start === end) {
      fmtClosed.current = null;
      setFmt(null);
    } else if (fmtClosed.current !== `${start}:${end}`) {
      setFmt((cur) => (cur?.start === start && cur.end === end ? cur : { start, end }));
    }
  };

  /** One undoable change of the field (onChange follows), then the toolbar for what it selects. */
  const applyEdit = (edit: TextEdit) => {
    const el = ta.current;
    if (!el) return;
    fmtApplying.current = true;
    try {
      applyTextEdit(el, edit);
    } finally {
      fmtApplying.current = false;
    }
    fmtClosed.current = null;
    setFmt(!touch && edit.selStart < edit.selEnd ? { start: edit.selStart, end: edit.selEnd } : null);
  };

  const applyFormat = (format: ToolbarFormat) => {
    const el = ta.current;
    if (!el) return;
    const { value, selectionStart: start, selectionEnd: end } = el;
    applyEdit(
      format === 'quote' ? toggleQuote(value, start, end) : toggleInline(value, start, end, format),
    );
  };

  const applyLink = (url: string) => {
    const el = ta.current;
    if (el) applyEdit(makeLink(el.value, el.selectionStart, el.selectionEnd, url));
  };

  /** Escape (closed for this selection) or Tab from the toolbar: back to the field. */
  const leaveFormatBar = (close: boolean) => {
    const el = ta.current;
    if (close && fmt) {
      fmtClosed.current = `${fmt.start}:${fmt.end}`;
      setFmt(null);
    }
    el?.focus({ preventScroll: true });
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
    setFmt(null);
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
    // A slash command at the start becomes its message (/shrug, /me, /tts …) or runs instead
    // of one (/nick, /thread); edits send as typed.
    const command = editing ? null : applyCommand(text, chat);
    if (command && 'missing' in command) {
      toast.info(`Type a ${command.missing.option} after /${command.missing.name}`, {
        id: 'slash-command',
      });
      return;
    }
    if (command && 'run' in command) {
      clearAfterSend();
      void command.run();
      return;
    }
    const encoded = encodeMentions(command ? command.text : text, refs.current).trim();
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
    // While the tray's files are on their way, typed text goes as a message of its own.
    if (trayRef.current.length && !batch.current) {
      sendWithAttachments(encoded);
      return;
    }
    if (!encoded) return;
    if (encoded.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Messages can be up to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters`);
      return;
    }
    const r = replyFields(reply);
    const ping = pingFlag(reply);
    clearAfterSend();
    if (sounds) playSound('sent');
    void sendQueued(
      chat.id,
      {
        type: 'text',
        text: encoded,
        replyToId: r.replyToId,
        ...ping,
        ...(command?.tts ? { tts: true } : {}),
      },
      { optimistic: r.replyTo ? { replyTo: r.replyTo } : undefined },
    );
  };

  const cancelEdit = () => useConversationUi.getState().setEditing(chat.id, null);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+B, I, U, Shift+X; an empty box leaves Ctrl/Cmd+I to the Inbox.
    const format = e.nativeEvent.isComposing ? null : shortcutFormat(e);
    if (format && (format !== 'italic' || text)) {
      e.preventDefault();
      applyFormat(format);
      return;
    }
    if (fmt && e.altKey && e.key === 'F10') {
      e.preventDefault();
      fmtBar.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
      return;
    }
    if (commands.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setCmdIdx((cmdActive + d + commands.length) % commands.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) || e.key === 'Tab') {
        e.preventDefault();
        pickCommand(commands[cmdActive]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setCmdDismissed(text);
        return;
      }
    }
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
      if (fmt) leaveFormatBar(true);
      else if (editing) cancelEdit();
      else if (emojiOpen) setEmojiOpen(false);
      else if (reply) useConversationUi.getState().setReply(chat.id, null);
      else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // ↑ in an empty field edits your last message (Discord; Escape cancels the edit).
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

  /** The phone preview's Send: its photos and videos join the tray and go with its caption. */
  const sendPreview = ({
    caption,
    items,
  }: {
    caption: string;
    items: { file: File; description: string }[];
  }) => {
    setPreview(null);
    if (batch.current) {
      toast.info(TRAY_BUSY, { id: 'tray-busy' });
      return;
    }
    const list = capped(items, MAX_ATTACHMENTS - trayRef.current.length);
    if (!list.length) return;
    setTray([
      ...trayRef.current,
      ...list.map((it) => ({ ...trayItem(it.file), description: it.description.trim() })),
    ]);
    sendWithAttachments(encodeMentions(caption, refs.current).trim());
  };

  /** Space channels without ATTACH_FILES: say so and refuse. */
  const attachDenied = () => {
    if (canAttach) return false;
    toast.error(NO_UPLOAD_PERMISSION, { id: 'attach-denied' });
    return true;
  };

  /** At most `room` of the files; the rest is refused with a toast. */
  const capped = <T,>(files: T[], room: number): T[] => {
    if (files.length <= room) return files;
    toast.error(TOO_MANY_ATTACHMENTS, { id: 'attach-limit' });
    return files.slice(0, Math.max(0, room));
  };

  const addToTray = (files: File[]) => {
    if (!files.length || attachDenied()) return;
    if (batch.current) {
      toast.info(TRAY_BUSY, { id: 'tray-busy' });
      return;
    }
    const list = capped(tooBig(files), MAX_ATTACHMENTS - trayRef.current.length);
    if (!list.length) return;
    setTray([...trayRef.current, ...list.map(trayItem)]);
    if (!touch) requestAnimationFrame(() => ta.current?.focus({ preventScroll: true }));
  };

  const removeFromTray = (id: string) => {
    const next = trayRef.current.filter((i) => i.id !== id);
    setTray(next);
    if (!next.length) setTrayStatus('idle');
  };

  const editTrayItem = (id: string, patch: TrayEdit) =>
    setTray(
      trayRef.current.map((i) => {
        if (i.id !== id) return i;
        const next: TrayItem = { ...i, ...patch };
        // Renamed or (un)marked as a spoiler: the file goes up again under its new name.
        if (
          (patch.name !== undefined && patch.name !== i.name) ||
          (patch.spoiler !== undefined && patch.spoiler !== i.spoiler)
        )
          delete next.upload;
        return next;
      }),
    );

  const moveTrayItem = (from: number, to: number) => {
    const next = trayRef.current.slice();
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    setTray(next);
  };

  const patchUpload = (id: string, upload: TrayUpload) =>
    setTray(trayRef.current.map((i) => (i.id === id ? { ...i, upload } : i)));

  /**
   * A cancelled or failed send's caption and reply come back to the composer (the caption
   * before whatever was typed meanwhile), so the next Enter sends them with the files.
   */
  const restoreLead = (lead: Lead) => {
    if (lead.caption) {
      const d = decodeMentions(lead.caption, mentionName, roleName);
      const typed = textRef.current;
      setText(typed.trim() ? `${d.text}\n${typed}` : d.text);
      refs.current = [...d.refs, ...refs.current];
    }
    const ui = useConversationUi.getState();
    if (!lead.replyToId || ui.reply[chat.id]) return;
    const m = useMessages.getState().byChat[chat.id]?.items.find((x) => x.id === lead.replyToId);
    if (!m) return;
    ui.setReply(chat.id, m);
    if (lead.mentionRepliedAuthor === false) setPingOff(m.id);
  };

  /**
   * Send the tray (see `batch`): upload what is not up yet, each tile showing its progress,
   * then send ONE message of every file. A failure keeps the tray, the failed tiles marked
   * (Retry = send again: only what is missing goes up), with the caption back in the field.
   */
  const runBatch = async (lead: Lead) => {
    const chatId = chat.id;
    const b = { lead, controller: new AbortController() };
    batch.current = b;
    setTrayStatus('sending');
    const items = trayRef.current;
    setTray(items.map((i) => (i.upload?.media ? i : { ...i, upload: { progress: 0 } })));
    let error: unknown = null;
    const media = await uploadAll(
      items.map((i) => ({ id: i.id, file: trayFile(i), kind: i.kind, media: i.upload?.media })),
      b.controller.signal,
      {
        onProgress: (id, progress) => patchUpload(id, { progress }),
        onUploaded: (id, m) => patchUpload(id, { progress: 1, media: m }),
        onFailed: (id, e) => {
          error ??= e;
          patchUpload(id, { progress: 0, failed: true });
        },
      },
    );
    if (batch.current !== b) return; // cancelled meanwhile
    batch.current = null;
    if (!media) {
      setTrayStatus('failed');
      restoreLead(lead);
      toast.error(error ?? 'Couldn’t upload your files', { id: 'tray-upload' });
      return;
    }
    setTray([]);
    setTrayStatus('idle');
    void sendAttachments(
      chatId,
      items.map((it, i) => ({
        media: media[i]!,
        description: it.kind === 'visual' ? it.description : null,
      })),
      lead,
    );
  };

  /** Cancel the tray's send: back to editing (finished uploads are kept), the caption back. */
  const cancelBatch = () => {
    const b = batch.current;
    if (!b) return;
    batch.current = null;
    b.controller.abort();
    setTrayStatus('idle');
    setTray(
      trayRef.current.map((i) => ({
        ...i,
        upload: i.upload?.media ? { progress: 1, media: i.upload.media } : undefined,
      })),
    );
    restoreLead(b.lead);
  };

  /** Enter / Send with files in the tray: ONE message of the text and every file. */
  const sendWithAttachments = (encoded: string) => {
    if (attachDenied()) return;
    if (encoded.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Messages can be up to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters`);
      return;
    }
    const r = replyFields(reply);
    const ping = pingFlag(reply);
    clearAfterSend();
    if (sounds) playSound('sent');
    let lead: Lead = { ...r, ...ping, caption: encoded || undefined };
    if (encoded.length > MAX_CAPTION_LENGTH) {
      // Too long for a caption: the text goes first as its own message, the files follow.
      void sendQueued(
        chat.id,
        { type: 'text', text: encoded, replyToId: r.replyToId, ...ping },
        { optimistic: r.replyTo ? { replyTo: r.replyTo } : undefined },
      );
      lead = {};
    }
    void runBatch(lead);
  };

  /**
   * Shift-drop: the files go right away, in one message (the typed text stays). With files
   * already waiting the drop joins them, like a plain one.
   */
  const uploadNow = (files: File[]) => {
    if (!files.length || attachDenied()) return;
    if (batch.current || trayRef.current.length) {
      addToTray(files);
      return;
    }
    const list = capped(tooBig(files), MAX_ATTACHMENTS);
    if (!list.length) return;
    setTray(list.map(trayItem));
    const r = replyFields(reply);
    const ping = pingFlag(reply);
    clearAfterAttachmentSend();
    void runBatch({ ...r, ...ping });
  };

  useBus('composer:files', ({ chatId, files, direct }) => {
    if (chatId !== chat.id) return;
    if (direct) uploadNow(files);
    else addToTray(files);
  });

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (!files.length) return;
    e.preventDefault();
    addToTray(files);
  };

  const onAttach = (kind: AttachKind) => {
    const upload = kind === 'media' || kind === 'document' || kind === 'audio' || kind === 'camera';
    if (upload && attachDenied()) return;
    if (kind === 'media') mediaInput.current?.click();
    else if (kind === 'document') docInput.current?.click();
    else if (kind === 'audio') audioInput.current?.click();
    else setDialog(kind);
  };

  // ---- voice notes -------------------------------------------------------

  const startRecording = async (locked: boolean) => {
    if (attachDenied()) return;
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
  // Discord: Enter sends on desktop (no send button unless "Show send button" is on); touch
  // keyboards and "Enter = new line" keep the button. Files waiting in the tray always show
  // it (not while they are being sent).
  const showSend =
    (hasText && (touch || !enterToSend || showSendPref)) ||
    (tray.length > 0 && trayStatus !== 'sending') ||
    !!editing ||
    (voice?.locked ?? false);
  const showMic = !showSend && (!hasText || !!voice);
  const placeholder = chat.space
    ? `Message ${isVoiceChannelType(chat.type) ? '🔊 ' : '#'}${chat.name ?? 'channel'}`
    : chat.type === 'direct'
      ? `Message @${title}`
      : `Message ${title}`;

  return (
    <div
      className="card-inset relative mx-2 mt-2 mb-[max(8px,env(safe-area-inset-bottom))] shrink-0 px-2 py-2 shadow-bubble sm:mx-3 sm:mb-[max(12px,env(safe-area-inset-bottom))] sm:px-3"
      data-testid="composer"
    >
      {suggestions.length ? (
        <MentionSuggestions
          id={listId}
          items={suggestions}
          active={mentionIdx}
          onPick={pickMention}
          onHover={setMentionIdx}
        />
      ) : null}
      <CommandSuggestions
        id={cmdListId}
        items={commands}
        active={cmdActive}
        onPick={pickCommand}
        onHover={setCmdIdx}
      />

      <AutoModBlockedNotice chatId={chat.id} />
      {fmt && !voice ? (
        <FormattingToolbar
          ref={fmtBar}
          field={ta}
          value={text}
          start={fmt.start}
          end={fmt.end}
          onFormat={applyFormat}
          onLink={applyLink}
          onLeave={leaveFormatBar}
          onBlurAway={() => setFmt(null)}
        />
      ) : null}
      {editing ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface-2 py-1.5 pr-1 pl-3 animate-slide-down">
          <Pencil size={16} className="shrink-0 text-brand-ink" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-brand-ink">Edit message</p>
            <p className="truncate text-[13px] text-muted">
              {decodeMentions(editing.text ?? '', mentionName, roleName).text}
            </p>
          </div>
          <IconButton icon={X} label="Cancel editing" size="sm" onClick={cancelEdit} />
        </div>
      ) : reply ? (
        <div className="mb-2 flex items-center gap-1 animate-slide-down">
          <ReplyQuote preview={previewOf(reply)} chatId={chat.id} className="flex-1" />
          {pingable(reply) ? (
            <button
              type="button"
              aria-pressed={pingOff !== reply.id}
              title={
                pingOff !== reply.id
                  ? 'Click to stop mentioning the original author'
                  : 'Click to mention the original author'
              }
              onClick={() => {
                setPingOff(pingOff === reply.id ? null : reply.id);
                ta.current?.focus({ preventScroll: true });
              }}
              className={cn(
                'shrink-0 rounded-md px-2 py-1 text-[13px] font-bold transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand',
                pingOff !== reply.id ? 'text-brand-ink' : 'text-muted',
              )}
            >
              {pingOff !== reply.id ? '@ ON' : '@ OFF'}
            </button>
          ) : null}
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
          <div className="min-w-0 flex-1 rounded-lg bg-surface-2">
            <AttachmentTray
              items={tray}
              touch={touch}
              status={trayStatus}
              onRemove={removeFromTray}
              onChange={editTrayItem}
              onReorder={moveTrayItem}
              onRetry={editing ? undefined : send}
              onCancel={cancelBatch}
              className="border-b border-line px-2.5"
            />
            <div className="flex min-h-11 items-end">
              {/* Discord: "+" opens uploads and the other attachment kinds. */}
              <IconButton
                icon={PlusCircle}
                label="Attach"
                aria-haspopup="menu"
                active={!!attachAnchor}
                onClick={(e) => setAttachAnchor(attachAnchor ? null : e.currentTarget)}
                className="m-1 shrink-0"
              />
              <textarea
                ref={ta}
                value={text}
                rows={1}
                onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
                onKeyDown={onKeyDown}
                onKeyUp={(e) =>
                  updateMention(e.currentTarget.value, e.currentTarget.selectionStart)
                }
                onClick={(e) =>
                  updateMention(e.currentTarget.value, e.currentTarget.selectionStart)
                }
                onSelect={(e) => syncFormatBar(e.currentTarget)}
                onBlur={(e) => {
                  typing.stop();
                  setTimeout(() => setMention(null), 150);
                  // Into the formatting toolbar (Alt+F10, its link field) keeps it.
                  if (!fmtBar.current?.contains(e.relatedTarget as Node | null)) setFmt(null);
                }}
                onPaste={onPaste}
                placeholder={editing ? 'Edit message' : placeholder}
                aria-label="Message"
                aria-autocomplete="list"
                aria-controls={
                  commands.length ? cmdListId : suggestions.length ? listId : undefined
                }
                aria-activedescendant={
                  commands.length
                    ? `${cmdListId}-${cmdActive}`
                    : suggestions.length
                      ? `${listId}-${mentionIdx}`
                      : undefined
                }
                enterKeyHint={enterToSend && !touch ? 'send' : 'enter'}
                className="max-h-[50vh] min-h-11 min-w-0 flex-1 resize-none bg-transparent py-[11px] text-chat leading-[1.375] text-fg outline-none placeholder:text-subtle"
              />
              {!hasText && !editing ? (
                <IconButton
                  icon={Camera}
                  label="Camera"
                  onClick={() => {
                    if (!attachDenied()) setDialog('camera');
                  }}
                  className="m-1 mr-0 shrink-0 sm:hidden"
                />
              ) : null}
              {!editing ? (
                <StickerButton
                  chat={chat}
                  text={text}
                  className={cn('m-1 mr-0 shrink-0', hasText && 'max-sm:hidden')}
                  onPick={(sticker, fromText) => {
                    // Sent at once (a reply when replying); a suggestion replaces the typed emoji.
                    const r = replyFields(reply);
                    const ping = pingFlag(reply);
                    if (fromText) clearAfterSend();
                    else clearAfterAttachmentSend();
                    if (sounds) playSound('sent');
                    void sendSticker(chat.id, sticker, { ...r, ...ping });
                  }}
                />
              ) : null}
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
            </div>
          </div>
        )}

        {showSend ? (
          <IconButton
            icon={editing ? Check : SendIcon}
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
        ) : showMic ? (
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
              'flex size-11 shrink-0 touch-none items-center justify-center rounded-lg bg-surface-2 text-muted transition-transform select-none hover:text-fg',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              voice && 'bg-danger text-white',
              voice && !voice.locked && 'scale-110',
            )}
          >
            {starting ? <Spinner size={20} label={null} /> : <Mic size={22} aria-hidden />}
          </button>
        ) : null}
      </div>

      {emojiOpen && !voice ? (
        <div className="mt-2 h-[min(300px,40dvh)] overflow-hidden rounded-xl bg-surface sm:h-[min(340px,42dvh)]">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-brand-ink">
                <Spinner />
              </div>
            }
          >
            <LazyEmojiPicker
              height="100%"
              custom={chat}
              onPick={(emoji) => {
                // Custom emoji show as ":name:" and are sent as their token (composerMentions).
                const picked = pickEmoji(emoji, refs.current);
                refs.current = picked.refs;
                insertAtCaret(picked.insert);
              }}
            />
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
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (!touch) {
            addToTray(files);
            return;
          }
          // Phones: the full-screen preview with captions.
          const ok = tooBig(files);
          if (ok.length) setPreview(ok);
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
          addToTray(files);
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
          addToTray(files);
        }}
      />

      {preview ? (
        <MediaPreviewDialog
          chat={chat}
          files={preview}
          initialCaption={text}
          onClose={() => setPreview(null)}
          onSend={sendPreview}
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
            { type: 'location', location, replyToId: r.replyToId, ...pingFlag(reply) },
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
            {
              type: 'contact',
              contact: { userId: c.user.id },
              replyToId: r.replyToId,
              ...pingFlag(reply),
            },
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
        chat={chat}
        onClose={() => setDialog(null)}
        onSend={(poll) => {
          setDialog(null);
          const r = replyFields(reply);
          clearAfterAttachmentSend();
          void sendQueued(
            chat.id,
            { type: 'poll', poll, replyToId: r.replyToId, ...pingFlag(reply) },
            { optimistic: r.replyTo ? { replyTo: r.replyTo } : undefined },
          );
        }}
      />
      <CameraDialog
        open={dialog === 'camera'}
        onClose={() => setDialog(null)}
        onCapture={(file) => {
          setDialog(null);
          if (touch) setPreview([file]);
          else addToTray([file]);
        }}
      />
    </div>
  );
}
