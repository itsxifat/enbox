/**
 * Per-chat appearance editor (README "Chat themes & animations" → Editing): a Sheet on
 * phones, a Modal on desktop. "Only for me" saves my private override through `patchPrefs`
 * (plus wallpaper uploads); "For everyone" (permissions.canEditInfo) saves the shared theme
 * through `setChatTheme`. The live preview shows the draft layered exactly as the chat will
 * render it. Mount it conditionally: `{open ? <ChatThemeSheet chat={chat} onClose={…} /> : null}`.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  WALLPAPER_BLUR_MAX,
  WALLPAPER_DIM_MAX,
  isSharedChatTheme,
  type ChatSummary,
  type ChatTheme,
  type SharedChatTheme,
} from '@enbox/shared';
import { Button, Modal, Sheet } from '@/components/ui';
import { patchPrefs, setChatTheme } from '@/features/chats/chatActions';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { toast, useUi } from '@/stores/ui';
import { ChatPreview } from './ChatPreview';
import {
  AccentPicker,
  AnimationPicker,
  BubbleStylePicker,
  PresetGrid,
  Segmented,
  SliderRow,
  WallpaperGrid,
} from './pickers';
import { EMPTY_THEME, contrastOk, isEmptyTheme, normalizeHex, resolveAppearance } from './presets';
import { uploadWallpaper } from './wallpaperUpload';

type Scope = 'me' | 'everyone';

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-3 rounded-2xl bg-surface-2/70 p-4', className)}>
      <h3 className="text-[12px] font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** A private theme is stored as null when nothing in it is set. */
function storable(theme: ChatTheme): ChatTheme | null {
  return isEmptyTheme(theme) && theme.dim === 0 && theme.blur === 0 ? null : theme;
}

export function ChatThemeSheet({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const desktop = useIsDesktop();
  const prefs = useUi((s) => s.prefs);
  const resolvedTheme = useUi((s) => s.resolvedTheme);
  const canShare = chat.permissions.canEditInfo;

  const [scope, setScope] = useState<Scope>('me');
  const [drafts, setDrafts] = useState<Record<Scope, ChatTheme>>({
    me: chat.theme ?? EMPTY_THEME,
    everyone: chat.sharedTheme ?? EMPTY_THEME,
  });
  const draft = drafts[scope];
  const [accentInput, setAccentInput] = useState<string | null>(draft.accent);
  const [busy, setBusy] = useState<'save' | 'upload' | 'reset' | null>(null);

  const update = (patch: Partial<ChatTheme>) =>
    setDrafts((d) => ({ ...d, [scope]: { ...d[scope], ...patch } }));
  const switchScope = (next: Scope) => {
    setScope(next);
    setAccentInput(drafts[next].accent);
  };

  // The accent field: raw input → canonical hex → contrast check; the draft only carries a valid one.
  const accentError = useMemo(() => {
    if (accentInput === null || accentInput === '') return null;
    const hex = normalizeHex(accentInput);
    if (!hex) return 'Enter a colour like #7c6cf8';
    if (!contrastOk(hex, resolvedTheme))
      return `Too little contrast with text in ${resolvedTheme} mode — pick a ${resolvedTheme === 'dark' ? 'darker' : 'lighter'} colour`;
    return null;
  }, [accentInput, resolvedTheme]);
  const onAccent = (raw: string | null) => {
    setAccentInput(raw);
    const hex = raw === null ? null : normalizeHex(raw);
    update({ accent: hex && contrastOk(hex, resolvedTheme) ? hex : null });
  };

  const appearance = useMemo(
    () =>
      scope === 'me'
        ? resolveAppearance({
            override: draft,
            shared: chat.sharedTheme,
            device: prefs,
            resolvedTheme,
            media: chat.wallpaper,
          })
        : resolveAppearance({
            override: null,
            shared: {
              ...draft,
              wallpaper: draft.wallpaper?.kind === 'preset' ? draft.wallpaper : null,
            },
            device: prefs,
            resolvedTheme,
          }),
    [scope, draft, chat.sharedTheme, chat.wallpaper, prefs, resolvedTheme],
  );

  const save = async () => {
    setBusy('save');
    try {
      let ok: boolean;
      if (scope === 'me') ok = await patchPrefs(chat, { theme: storable(draft) });
      else {
        const shared: SharedChatTheme = isSharedChatTheme(draft)
          ? draft
          : { ...draft, wallpaper: null };
        ok = await setChatTheme(chat.id, storable(shared) as SharedChatTheme | null);
      }
      if (ok) onClose();
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy('reset');
    try {
      const ok =
        scope === 'me'
          ? await patchPrefs(chat, { theme: null, wallpaperMediaId: null })
          : await setChatTheme(chat.id, null);
      if (ok) onClose();
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    setBusy('upload');
    try {
      const media = await uploadWallpaper(file);
      const theme: ChatTheme = { ...draft, wallpaper: { kind: 'media' } };
      const ok = await patchPrefs(chat, { wallpaperMediaId: media.id, theme });
      if (ok) setDrafts((d) => ({ ...d, me: theme }));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const wallpaperChoice =
    draft.wallpaper === null
      ? null
      : draft.wallpaper.kind === 'media'
        ? 'media'
        : draft.wallpaper.id;

  const body = (
    <div className="flex flex-col gap-3">
      {canShare ? (
        <Segmented<Scope>
          aria-label="Who sees this theme"
          value={scope}
          onChange={switchScope}
          options={[
            { value: 'me', label: 'Only for me' },
            { value: 'everyone', label: 'For everyone' },
          ]}
        />
      ) : null}
      <ChatPreview appearance={appearance} className="min-h-28" />
      <Card title="Theme">
        <PresetGrid
          value={draft.preset}
          onChange={(preset) => update({ preset })}
          resolvedTheme={resolvedTheme}
        />
      </Card>
      <Card title="Bubbles">
        <BubbleStylePicker
          value={draft.bubbleStyle ?? appearance.bubbleStyle}
          onChange={(bubbleStyle) => update({ bubbleStyle })}
        />
      </Card>
      <Card title="Accent">
        <AccentPicker
          value={accentInput}
          onChange={onAccent}
          resolvedTheme={resolvedTheme}
          error={accentError}
        />
      </Card>
      <Card title="Wallpaper">
        <WallpaperGrid
          value={wallpaperChoice}
          onChange={(id) =>
            update({ wallpaper: id === 'media' ? { kind: 'media' } : { kind: 'preset', id } })
          }
          resolvedTheme={resolvedTheme}
          media={scope === 'me' ? chat.wallpaper : null}
          onUpload={scope === 'me' ? (file) => void upload(file) : undefined}
          uploading={busy === 'upload'}
        />
        <SliderRow
          label="Dim"
          value={draft.dim}
          max={WALLPAPER_DIM_MAX}
          unit="%"
          onChange={(dim) => update({ dim })}
        />
        <SliderRow
          label="Blur"
          value={draft.blur}
          max={WALLPAPER_BLUR_MAX}
          unit="px"
          disabled={draft.wallpaper?.kind !== 'media'}
          onChange={(blur) => update({ blur })}
        />
      </Card>
      <Card title="New messages">
        <AnimationPicker
          value={draft.messageAnimation ?? appearance.messageAnimation}
          onChange={(messageAnimation) => update({ messageAnimation })}
        />
      </Card>
      <p className="px-1 text-[12.5px] leading-relaxed text-muted">
        {scope === 'me'
          ? 'Only you see this, on all your devices.'
          : 'Everyone in this chat will see the new theme and a note that you changed it.'}
      </p>
    </div>
  );

  const footer = (
    <>
      <Button
        variant="ghost"
        onClick={() => void reset()}
        loading={busy === 'reset'}
        disabled={!!busy && busy !== 'reset'}
      >
        Reset
      </Button>
      <Button variant="secondary" onClick={onClose} disabled={!!busy}>
        Cancel
      </Button>
      <Button
        onClick={() => void save()}
        loading={busy === 'save'}
        disabled={!!accentError || (!!busy && busy !== 'save')}
      >
        Save
      </Button>
    </>
  );

  if (desktop)
    return (
      <Modal open onClose={onClose} title="Chat theme" size="lg" footer={footer}>
        {body}
      </Modal>
    );
  return (
    <Sheet open onClose={onClose} title="Chat theme">
      <div className="px-4 py-4">{body}</div>
      <div className="sticky bottom-0 flex justify-end gap-2 bg-surface/95 px-4 py-3 backdrop-blur-sm">
        {footer}
      </div>
    </Sheet>
  );
}
