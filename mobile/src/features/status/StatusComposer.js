/**
 * Status composer (web features/status/StatusComposer.tsx): full-screen text status
 * (background colours, font cycle, emoji) or photo/video status with a caption. Posting
 * continues in the background (the "My status" row shows progress).
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ImagePlus, Keyboard, Lock, Palette, Smile, Type, X } from 'lucide-react-native';
import { STATUS_TEXT_MAX_LENGTH } from '@enbox/shared';
import { Icon, SendIcon } from '@/components/icons';
import { Gradient, Press, Spinner, T, toast, useBackHandler } from '@/components/ui';
import { EmojiPanel } from '@/features/emoji/EmojiPanel';
import { pickOne } from '@/lib/imagePick';
import { useMe } from '@/stores/auth';
import { useStatus } from '@/stores/status';
import { useTheme } from '@/theme';
import { DEFAULT_STATUS_COLOR, STATUS_FONTS, fontStyle, nextColor, textStatusSize } from './logic';
import { prepareStatusMedia, takePendingStatusFile } from './media';
import { StatusPrivacyDialog } from './StatusPrivacyDialog';

const PRIVACY_LABEL = {
  contacts: 'My contacts',
  contacts_except: 'My contacts except…',
  only_share_with: 'Only share with…',
};

function PrivacyChip({ onPress, dark = true }) {
  const privacy = useMe()?.settings.statusPrivacy ?? 'contacts';
  return (
    <Press
      onPress={onPress}
      feedback={false}
      accessibilityLabel={`Status privacy: ${PRIVACY_LABEL[privacy]}`}
      style={({ pressed }) => ({
        height: 36,
        minWidth: 0,
        flexShrink: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        paddingHorizontal: 14,
        backgroundColor: dark
          ? pressed
            ? 'rgba(0,0,0,0.45)'
            : 'rgba(0,0,0,0.3)'
          : pressed
            ? 'rgba(255,255,255,0.3)'
            : 'rgba(255,255,255,0.2)',
      })}
    >
      <Icon icon={Lock} size={14} color="#fff" />
      <T numberOfLines={1} style={{ fontSize: 13, fontWeight: '500', color: '#fff' }}>
        {PRIVACY_LABEL[privacy]}
      </T>
    </Press>
  );
}

function ToolButton({ icon, label, onPress, pressed, children }) {
  return (
    <Press
      accessibilityLabel={label}
      accessibilityState={{ selected: !!pressed }}
      onPress={onPress}
      feedback={false}
      style={({ pressed: down }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? 'rgba(0,0,0,0.2)' : down ? 'rgba(0,0,0,0.15)' : 'transparent',
      })}
    >
      {children ?? <Icon icon={icon} size={22} color="#fff" />}
    </Press>
  );
}

export function StatusComposer() {
  const router = useRouter();
  const [file, setFile] = useState(() => takePendingStatusFile());
  const close = () => (router.canGoBack() ? router.back() : router.replace('/updates'));
  useBackHandler(() => {
    close();
    return true;
  }, true);
  return (
    <View style={StyleSheet.absoluteFill}>
      {file ? (
        <MediaComposer file={file} onChange={setFile} onClose={close} />
      ) : (
        <TextComposer onPickFile={setFile} onClose={close} />
      )}
    </View>
  );
}

async function pickStatusFile() {
  return pickOne({ video: true, title: 'Status' });
}

function TextComposer({ onPickFile, onClose }) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [color, setColor] = useState(DEFAULT_STATUS_COLOR);
  const [font, setFont] = useState(0);
  const [emoji, setEmoji] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const ref = useRef(null);
  const trimmed = text.trim();
  const size = textStatusSize(text || 'Type a status');
  const left = STATUS_TEXT_MAX_LENGTH - [...text].length;

  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 250);
    return () => clearTimeout(t);
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

  const insert = (value) => {
    const start = Math.min(sel.start, text.length);
    const end = Math.min(sel.end, text.length);
    const next = (text.slice(0, start) + value + text.slice(end)).slice(0, STATUS_TEXT_MAX_LENGTH);
    setText(next);
    const at = start + value.length;
    setSel({ start: at, end: at });
  };

  const toggleEmoji = () => {
    if (emoji) {
      setEmoji(false);
      setTimeout(() => ref.current?.focus(), 50);
    } else {
      ref.current?.blur();
      setEmoji(true);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: color }}>
      <View
        style={{
          height: 64 + insets.top,
          paddingTop: insets.top,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 8,
        }}
      >
        <ToolButton icon={X} label="Close" onPress={onClose} />
        <View style={{ flex: 1 }} />
        <ToolButton
          icon={emoji ? Keyboard : Smile}
          label={emoji ? 'Keyboard' : 'Emoji'}
          pressed={emoji}
          onPress={toggleEmoji}
        />
        <ToolButton
          label={`Font: ${STATUS_FONTS[font].name}. Change font`}
          onPress={() => setFont((f) => (f + 1) % STATUS_FONTS.length)}
        >
          <T style={[{ fontSize: 19, color: '#fff' }, fontStyle(font)]}>Aa</T>
        </ToolButton>
        <ToolButton
          icon={Palette}
          label="Change background color"
          onPress={() => setColor((c) => nextColor(c))}
        />
      </View>

      <View
        style={{
          flex: 1,
          minHeight: 0,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
        }}
      >
        <TextInput
          ref={ref}
          value={text}
          maxLength={STATUS_TEXT_MAX_LENGTH}
          onChangeText={setText}
          onSelectionChange={(e) => setSel(e.nativeEvent.selection)}
          onFocus={() => setEmoji(false)}
          placeholder="Type a status"
          placeholderTextColor="rgba(255,255,255,0.6)"
          accessibilityLabel="Status text"
          multiline
          cursorColor="#ffffff"
          selectionColor="rgba(255,255,255,0.5)"
          style={[
            {
              width: '100%',
              maxWidth: 672,
              maxHeight: '100%',
              // The web's `rows={4}` textarea: text starts on the top line of a 4-line box.
              minHeight: Math.round(size * 1.25) * 4,
              textAlignVertical: 'top',
              textAlign: 'center',
              color: '#fff',
              fontSize: size,
              lineHeight: Math.round(size * 1.25),
              padding: 0,
            },
            fontStyle(font),
          ]}
        />
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: emoji ? 12 : Math.max(16, insets.bottom),
        }}
      >
        <Press
          onPress={async () => {
            const f = await pickStatusFile();
            if (f) onPickFile(f);
          }}
          feedback={false}
          style={({ pressed }) => ({
            height: 36,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderRadius: 999,
            paddingHorizontal: 14,
            backgroundColor: pressed ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.3)',
          })}
        >
          <Icon icon={ImagePlus} size={16} color="#fff" />
          <T style={{ fontSize: 13, fontWeight: '500', color: '#fff' }}>Photo & video</T>
        </Press>
        <PrivacyChip onPress={() => setPrivacy(true)} />
        <View style={{ flex: 1 }} />
        {left <= 80 ? (
          <T
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', fontVariant: ['tabular-nums'] }}
          >
            {left}
          </T>
        ) : null}
        <Press
          accessibilityLabel="Send status"
          disabled={!trimmed || sending}
          onPress={() => void send()}
          feedback={false}
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#ffffff',
            opacity: !trimmed || sending ? 0.4 : 1,
            boxShadow: '0px 20px 25px -5px rgba(0,0,0,0.2)',
          }}
        >
          {sending ? (
            <Spinner size={22} color="#15141c" />
          ) : (
            <Icon icon={SendIcon} size={24} color="#15141c" />
          )}
        </Press>
      </View>
      {emoji ? (
        <View style={{ paddingBottom: insets.bottom, backgroundColor: 'rgba(0,0,0,0.15)' }}>
          <EmojiPanel height={300} onPick={insert} />
        </View>
      ) : null}
      <StatusPrivacyDialog open={privacy} onClose={() => setPrivacy(false)} />
    </KeyboardAvoidingView>
  );
}

function VideoPreview({ uri }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

function MediaComposer({ file, onChange, onClose }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [prepared, setPrepared] = useState(null);
  const [error, setError] = useState(null);
  const [caption, setCaption] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const video = (file.type ?? '').startsWith('video/');

  useEffect(() => {
    let alive = true;
    setPrepared(null);
    setError(null);
    prepareStatusMedia(file).then(
      (p) => alive && setPrepared(p),
      (e) => alive && setError(e instanceof Error ? e.message : 'This file cannot be shared'),
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
      thumbnail: prepared.thumbnail,
      caption,
    });
    onClose();
    p.then(
      () => toast.success('Status posted'),
      (e) => toast.error(e, { description: "Your status wasn't posted" }),
    );
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={StyleSheet.absoluteFill}>
        {video ? (
          <VideoPreview uri={file.uri} />
        ) : (
          <Image
            source={{ uri: file.uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            accessibilityLabel="Photo preview"
          />
        )}
      </View>
      <Gradient
        direction="down"
        stops={[
          [0, '#000000', 0.6],
          [1, '#000000', 0],
        ]}
        style={{
          height: 64 + insets.top,
          paddingTop: insets.top,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 8,
        }}
      >
        <ToolButton icon={X} label="Close" onPress={onClose} />
        <View style={{ flex: 1 }} />
        <Press
          onPress={async () => {
            const f = await pickStatusFile();
            if (f) onChange(f);
          }}
          feedback={false}
          style={({ pressed }) => ({
            height: 36,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderRadius: 999,
            paddingHorizontal: 14,
            backgroundColor: pressed ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.15)',
          })}
        >
          <Icon icon={ImagePlus} size={16} color="#fff" />
          <T style={{ fontSize: 13, fontWeight: '500', color: '#fff' }}>Change</T>
        </Press>
        <ToolButton icon={Type} label="Text status instead" onPress={() => onChange(null)} />
      </Gradient>
      <View style={{ flex: 1 }} />
      {error ? (
        <View
          accessibilityRole="alert"
          style={{
            alignSelf: 'center',
            marginBottom: 12,
            borderRadius: 999,
            backgroundColor: '#e5484d',
            paddingHorizontal: 16,
            paddingVertical: 8,
            maxWidth: width - 32,
          }}
        >
          <T style={{ fontSize: 14, fontWeight: '500', color: '#fff' }}>{error}</T>
        </View>
      ) : null}
      <Gradient
        direction="up"
        stops={[
          [0, '#000000', 0.7],
          [1, '#000000', 0],
        ]}
        style={{
          gap: 8,
          paddingHorizontal: 12,
          paddingTop: 32,
          paddingBottom: Math.max(16, insets.bottom),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            value={caption}
            onChangeText={(v) => setCaption(v.slice(0, STATUS_TEXT_MAX_LENGTH))}
            onSubmitEditing={send}
            returnKeyType="send"
            placeholder="Add a caption…"
            placeholderTextColor="rgba(255,255,255,0.6)"
            accessibilityLabel="Caption"
            cursorColor="#ffffff"
            style={{
              flex: 1,
              minWidth: 0,
              height: 48,
              borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.15)',
              paddingHorizontal: 20,
              fontSize: 15,
              color: '#fff',
            }}
          />
          <SendButton ready={!!prepared} error={!!error} onPress={send} />
        </View>
        <View style={{ flexDirection: 'row' }}>
          <PrivacyChip onPress={() => setPrivacy(true)} />
        </View>
      </Gradient>
      <StatusPrivacyDialog open={privacy} onClose={() => setPrivacy(false)} />
    </KeyboardAvoidingView>
  );
}

function SendButton({ ready, error, onPress }) {
  const { c } = useTheme();
  return (
    <Press
      accessibilityLabel="Send status"
      disabled={!ready}
      onPress={onPress}
      feedback={false}
      style={{
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c.brand,
        opacity: ready ? 1 : 0.5,
        boxShadow: '0px 20px 25px -5px rgba(0,0,0,0.3)',
      }}
    >
      {!ready && !error ? (
        <Spinner size={20} color="#ffffff" />
      ) : (
        <Icon icon={SendIcon} size={22} color={c['on-brand']} />
      )}
    </Press>
  );
}
