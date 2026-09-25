/**
 * Status composer (/updates/status/new): full-screen text status (background colors, font
 * cycle, emoji) or photo/video status with caption (photos re-encoded, videos ≤ 60 s).
 * Posting continues in the background (the "My status" row shows progress).
 */
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ImagePlus, Lock, Palette, Smile, Type, X } from 'lucide-react';
import { STATUS_TEXT_MAX_LENGTH } from '@enbox/shared';
import { SendIcon } from '@/components/icons';
import { Portal, Spinner, toast, useFocusTrap, useOverlay } from '@/components/ui';
import { cn } from '@/lib/cn';
import { lazyNamed } from '@/lib/lazy';
import { useMe } from '@/stores/auth';
import { useStatus } from '@/stores/status';
import { useUi } from '@/stores/ui';
import { DEFAULT_STATUS_COLOR, STATUS_FONTS, fontStyle, nextColor, textStatusSize } from './logic';
import { prepareStatusMedia, type PreparedMedia } from './media';
import { StatusPrivacyDialog } from './StatusPrivacyDialog';

const EmojiPicker = lazyNamed(() => import('./EmojiPickerPanel'), 'EmojiPickerPanel');

const PRIVACY_LABEL = {
  contacts: 'My contacts',
  contacts_except: 'My contacts except…',
  only_share_with: 'Only share with…',
} as const;

function useClose() {
  const navigate = useNavigate();
  return () => navigate('/updates', { replace: true });
}

function PrivacyChip({ onClick, dark = true }: { onClick: () => void; dark?: boolean }) {
  const privacy = useMe()?.settings.statusPrivacy ?? 'contacts';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Status privacy: ${PRIVACY_LABEL[privacy]}`}
      className={cn(
        'flex h-9 min-w-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium backdrop-blur',
        dark
          ? 'bg-black/30 text-white hover:bg-black/45'
          : 'bg-white/20 text-white hover:bg-white/30',
      )}
    >
      <Lock size={14} aria-hidden />
      <span className="truncate">{PRIVACY_LABEL[privacy]}</span>
    </button>
  );
}

export function StatusComposer() {
  const location = useLocation();
  const initialFile = (location.state as { file?: File } | null)?.file ?? null;
  const [file, setFile] = useState<File | null>(initialFile);
  const close = useClose();
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, true);
  // Escape closes the composer unless a dialog opened above it (overlay stack).
  useOverlay(true, close);

  return (
    <Portal>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="New status"
        data-testid="status-composer"
        className="fixed inset-0 z-[44] flex animate-fade-in flex-col text-white px-safe"
      >
        {file ? (
          <MediaComposer file={file} onChange={setFile} onClose={close} />
        ) : (
          <TextComposer onPickFile={setFile} onClose={close} />
        )}
      </div>
    </Portal>
  );
}

function FilePicker({
  onPick,
  children,
  className,
}: {
  onPick: (f: File) => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.click()}>
        {children}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        tabIndex={-1}
        aria-hidden
        data-testid="status-composer-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onPick(f);
        }}
      />
    </>
  );
}

function TextComposer({
  onPickFile,
  onClose,
}: {
  onPickFile: (f: File) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [color, setColor] = useState(DEFAULT_STATUS_COLOR);
  const [font, setFont] = useState(0);
  const [emoji, setEmoji] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const enterToSend = useUi((s) => s.prefs.enterToSend);
  const trimmed = text.trim();
  const size = textStatusSize(text || 'Type a status');
  const left = STATUS_TEXT_MAX_LENGTH - [...text].length;

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const send = async () => {
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await useStatus.getState().postText({ text: trimmed, backgroundColor: color, font });
      toast.success('Status posted');
      onClose();
    } catch (e) {
      toast.error(e);
      setSending(false);
    }
  };

  const insert = (value: string) => {
    const el = ref.current;
    if (!el) return setText((t) => t + value);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = (text.slice(0, start) + value + text.slice(end)).slice(0, STATUS_TEXT_MAX_LENGTH);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + value.length, start + value.length);
    });
  };

  return (
    <div
      className="relative flex flex-1 flex-col transition-colors duration-300"
      style={{ backgroundColor: color }}
    >
      <header className="flex h-16 shrink-0 items-center gap-1 px-2 pt-safe sm:px-4">
        <ToolButton icon={X} label="Close" onClick={onClose} />
        <div className="flex-1" />
        <ToolButton
          icon={Smile}
          label="Emoji"
          pressed={emoji}
          onClick={() => setEmoji((v) => !v)}
        />
        <button
          type="button"
          aria-label={`Font: ${STATUS_FONTS[font]!.name}. Change font`}
          title="Change font"
          onClick={() => setFont((f) => (f + 1) % STATUS_FONTS.length)}
          className="flex size-11 items-center justify-center rounded-full text-[19px] text-white hover:bg-black/15"
          style={fontStyle(font)}
        >
          <span aria-hidden>Aa</span>
        </button>
        <ToolButton
          icon={Palette}
          label="Change background color"
          onClick={() => setColor((c) => nextColor(c))}
        />
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <textarea
          ref={ref}
          value={text}
          maxLength={STATUS_TEXT_MAX_LENGTH}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              enterToSend &&
              !e.nativeEvent.isComposing &&
              window.matchMedia('(pointer: fine)').matches
            ) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Type a status"
          aria-label="Status text"
          rows={4}
          className="max-h-full w-full max-w-2xl resize-none bg-transparent text-center leading-tight text-white placeholder:text-white/60 focus:outline-none"
          style={{ fontSize: size, ...fontStyle(font) }}
        />
      </div>

      {emoji ? (
        <div className="absolute top-16 right-3 z-10 sm:right-6">
          <Suspense
            fallback={
              <div className="flex h-[360px] w-[320px] items-center justify-center rounded-2xl bg-elevated">
                <Spinner />
              </div>
            }
          >
            <EmojiPicker onPick={insert} />
          </Suspense>
        </div>
      ) : null}

      <footer className="flex shrink-0 items-center gap-2 px-3 pt-2 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-6">
        <FilePicker
          onPick={onPickFile}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-black/30 px-3.5 text-[13px] font-medium backdrop-blur hover:bg-black/45"
        >
          <ImagePlus size={16} aria-hidden /> Photo & video
        </FilePicker>
        <PrivacyChip onClick={() => setPrivacy(true)} />
        <div className="flex-1" />
        {left <= 80 ? <span className="text-[12px] text-white/80 tabular-nums">{left}</span> : null}
        <button
          type="button"
          aria-label="Send status"
          title="Send"
          disabled={!trimmed || sending}
          onClick={() => void send()}
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white text-[#15141c] shadow-xl transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
        >
          {sending ? <Spinner size={22} label={null} /> : <SendIcon size={24} aria-hidden />}
        </button>
      </footer>
      <StatusPrivacyDialog open={privacy} onClose={() => setPrivacy(false)} />
    </div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  pressed,
}: {
  icon: typeof X;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'flex size-11 items-center justify-center rounded-full text-white transition-colors hover:bg-black/15 focus-visible:outline-2 focus-visible:outline-white',
        pressed && 'bg-black/20',
      )}
    >
      <Icon size={22} aria-hidden />
    </button>
  );
}

function MediaComposer({
  file,
  onChange,
  onClose,
}: {
  file: File;
  onChange: (f: File | null) => void;
  onClose: () => void;
}) {
  const [prepared, setPrepared] = useState<PreparedMedia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const video = file.type.startsWith('video/');

  useEffect(() => {
    let alive = true;
    setPrepared(null);
    setError(null);
    prepareStatusMedia(file).then(
      (p) => alive && setPrepared(p),
      (e: unknown) =>
        alive && setError(e instanceof Error ? e.message : 'This file cannot be shared'),
    );
    return () => {
      alive = false;
    };
  }, [file]);

  const send = () => {
    if (!prepared) return;
    const p = useStatus.getState().postMedia({
      file: prepared.blob,
      meta: prepared.meta,
      fileName: prepared.fileName,
      caption,
    });
    onClose();
    p.then(
      () => toast.success('Status posted'),
      (e: unknown) => toast.error(e, { description: "Your status wasn't posted" }),
    );
  };

  return (
    <div className="relative flex flex-1 flex-col bg-black">
      <div className="absolute inset-0 flex items-center justify-center">
        {video ? (
          <video
            src={url}
            className="max-h-full max-w-full"
            autoPlay
            muted
            loop
            playsInline
            controls={false}
            aria-label="Video preview"
          />
        ) : (
          <img src={url} alt="Photo preview" className="max-h-full max-w-full object-contain" />
        )}
      </div>
      <header className="relative flex h-16 shrink-0 items-center gap-1 bg-gradient-to-b from-black/60 to-transparent px-2 pt-safe sm:px-4">
        <ToolButton icon={X} label="Close" onClick={onClose} />
        <div className="flex-1" />
        <FilePicker
          onPick={onChange}
          className="flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3.5 text-[13px] font-medium hover:bg-white/25"
        >
          <ImagePlus size={16} aria-hidden /> Change
        </FilePicker>
        <ToolButton icon={Type} label="Text status instead" onClick={() => onChange(null)} />
      </header>
      <div className="flex-1" />
      {error ? (
        <div
          className="relative mx-auto mb-3 rounded-full bg-danger px-4 py-2 text-[14px] font-medium text-white"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      <footer className="relative flex shrink-0 flex-col gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-6">
        <div className="flex items-center gap-2">
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, STATUS_TEXT_MAX_LENGTH))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Add a caption…"
            aria-label="Caption"
            className="h-12 min-w-0 flex-1 rounded-full bg-white/15 px-5 text-[15px] text-white placeholder:text-white/60 backdrop-blur focus:bg-white/20 focus:outline-none"
          />
          <button
            type="button"
            aria-label="Send status"
            title="Send"
            disabled={!prepared}
            onClick={send}
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand shadow-xl transition-transform hover:scale-105 disabled:opacity-50"
          >
            {!prepared && !error ? (
              <Spinner size={20} label="Preparing" />
            ) : (
              <SendIcon size={22} aria-hidden />
            )}
          </button>
        </div>
        <div className="flex">
          <PrivacyChip onClick={() => setPrivacy(true)} />
        </div>
      </footer>
      <StatusPrivacyDialog open={privacy} onClose={() => setPrivacy(false)} />
    </div>
  );
}
