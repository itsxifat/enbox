/**
 * Per-chat appearance editor (web features/appearance/ChatThemeSheet.tsx), a full-screen
 * Sheet as on phones: "Only for me" saves my private override through `patchPrefs` (plus
 * wallpaper uploads); "For everyone" (permissions.canEditInfo) saves the shared theme
 * through `setChatTheme`. The live preview shows the draft layered as the chat will render.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WALLPAPER_BLUR_MAX, WALLPAPER_DIM_MAX, isSharedChatTheme } from '@enbox/shared';
import { Button, Sheet, T } from '@/components/ui';
import { patchPrefs, setChatTheme } from '@/features/chats/chatActions';
import { pickOne } from '@/lib/imagePick';
import { toast, useUi } from '@/stores/ui';
import { alpha, useTheme } from '@/theme';
import { useResolvedAppearance } from './ChatBackground';
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
import { EMPTY_THEME, contrastOk, isEmptyTheme, normalizeHex } from './presets';
import { uploadWallpaper } from './wallpaperUpload';

function Card({ title, children }) {
  const { tw, c } = useTheme();
  return (
    <View style={[tw`gap-3 rounded-2xl p-4`, { backgroundColor: alpha(c['surface-2'], 0.7) }]}>
      <T style={[tw`text-[12px] font-semibold uppercase text-muted`, { letterSpacing: 0.3 }]}>
        {title}
      </T>
      {children}
    </View>
  );
}

/** A private theme is stored as null when nothing in it is set. */
function storable(theme) {
  return isEmptyTheme(theme) && theme.dim === 0 && theme.blur === 0 ? null : theme;
}

export function ChatThemeSheet({ chat, onClose }) {
  const { tw, c } = useTheme();
  const insets = useSafeAreaInsets();
  const prefs = useUi((s) => s.prefs);
  const resolvedTheme = useUi((s) => s.resolvedTheme);
  const canShare = chat.permissions.canEditInfo;

  const [scope, setScope] = useState('me');
  const [drafts, setDrafts] = useState({
    me: chat.theme ?? EMPTY_THEME,
    everyone: chat.sharedTheme ?? EMPTY_THEME,
  });
  const draft = drafts[scope];
  const [accentInput, setAccentInput] = useState(draft.accent);
  const [busy, setBusy] = useState(null);

  const update = (patch) => setDrafts((d) => ({ ...d, [scope]: { ...d[scope], ...patch } }));
  const switchScope = (next) => {
    setScope(next);
    setAccentInput(drafts[next].accent);
  };

  const accentError = useMemo(() => {
    if (accentInput === null || accentInput === '') return null;
    const hex = normalizeHex(accentInput);
    if (!hex) return 'Enter a colour like #7c6cf8';
    if (!contrastOk(hex, resolvedTheme))
      return `Too little contrast with text in ${resolvedTheme} mode — pick a ${resolvedTheme === 'dark' ? 'darker' : 'lighter'} colour`;
    return null;
  }, [accentInput, resolvedTheme]);
  const onAccent = (raw) => {
    setAccentInput(raw);
    const hex = raw === null ? null : normalizeHex(raw);
    update({ accent: hex && contrastOk(hex, resolvedTheme) ? hex : null });
  };

  const sharedDraft = useMemo(
    () => ({ ...draft, wallpaper: draft.wallpaper?.kind === 'preset' ? draft.wallpaper : null }),
    [draft],
  );
  const appearance = useResolvedAppearance(
    scope === 'me'
      ? {
          override: draft,
          shared: chat.sharedTheme,
          device: prefs,
          resolvedTheme,
          media: chat.wallpaper,
        }
      : { override: null, shared: sharedDraft, device: prefs, resolvedTheme, media: null },
  );

  const save = async () => {
    setBusy('save');
    try {
      let ok;
      if (scope === 'me') ok = await patchPrefs(chat, { theme: storable(draft) });
      else {
        const shared = isSharedChatTheme(draft) ? draft : { ...draft, wallpaper: null };
        ok = await setChatTheme(chat.id, storable(shared));
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

  const upload = async () => {
    const file = await pickOne({ video: true, title: 'Wallpaper' });
    if (!file) return;
    setBusy('upload');
    try {
      const media = await uploadWallpaper(file);
      const theme = { ...draft, wallpaper: { kind: 'media' } };
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

  return (
    <Sheet open onClose={onClose} title="Chat theme" scroll={false}>
      <View style={tw`flex-1`}>
        <SheetBody>
          {canShare ? (
            <Segmented
              label="Who sees this theme"
              value={scope}
              onChange={switchScope}
              options={[
                { value: 'me', label: 'Only for me' },
                { value: 'everyone', label: 'For everyone' },
              ]}
            />
          ) : null}
          <ChatPreview appearance={appearance} />
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
              onUpload={scope === 'me' ? () => void upload() : undefined}
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
          <T style={[tw`px-1 text-[12.5px] text-muted`, { lineHeight: 20 }]}>
            {scope === 'me'
              ? 'Only you see this, on all your devices.'
              : 'Everyone in this chat will see the new theme and a note that you changed it.'}
          </T>
        </SheetBody>
        <View
          style={[
            tw`flex-row justify-end gap-2 px-4 pt-3`,
            { backgroundColor: alpha(c.surface, 0.95), paddingBottom: Math.max(12, insets.bottom) },
          ]}
        >
          <Button
            variant="ghost"
            onPress={() => void reset()}
            loading={busy === 'reset'}
            disabled={!!busy && busy !== 'reset'}
          >
            Reset
          </Button>
          <Button variant="secondary" onPress={onClose} disabled={!!busy}>
            Cancel
          </Button>
          <Button
            onPress={() => void save()}
            loading={busy === 'save'}
            disabled={!!accentError || (!!busy && busy !== 'save')}
          >
            Save
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

function SheetBody({ children }) {
  const { tw } = useTheme();
  // The Sheet's own ScrollView is off so the footer stays pinned under this one.
  return (
    <KeyboardAwareScrollView
      style={tw`flex-1`}
      contentContainerStyle={tw`gap-3 px-4 py-4`}
      keyboardShouldPersistTaps="handled"
      bottomOffset={16}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
