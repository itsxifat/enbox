/**
 * Photos & videos preview before sending (web composer/MediaPreviewDialog.tsx): large
 * preview, per-item caption, thumbnail strip (add more / remove), send.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Play, Plus, Trash2, X } from 'lucide-react-native';
import { MAX_CAPTION_LENGTH, chatTitle } from '@enbox/shared';
import { Icon, SendIcon } from '@/components/icons';
import { IconButton, Portal, Press, T, useBackHandler } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme';
import { pickMedia } from '../lib/mediaProcessing';

export function MediaPreview({ chat, files, initialCaption, onClose, onSend }) {
  const { tw } = useTheme();
  const insets = useSafeAreaInsets();
  const me = useAuth((s) => s.user?.id);
  const [items, setItems] = useState(() =>
    files.map((file, i) => ({
      id: `${i}-${file.uri}`,
      file,
      caption: i === 0 ? (initialCaption ?? '') : '',
    })),
  );
  const [current, setCurrent] = useState(0);
  useBackHandler(() => {
    onClose();
    return true;
  });
  const item = items[Math.min(current, items.length - 1)];
  if (!item) return null;
  const video = (item.file.type ?? '').startsWith('video/');

  const remove = (id) => {
    const next = items.filter((x) => x.id !== id);
    if (!next.length) onClose();
    else {
      setItems(next);
      setCurrent((c) => Math.min(c, next.length - 1));
    }
  };

  return (
    <Portal>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0b0b10' }]}>
        <KeyboardAvoidingView behavior="padding" style={tw`flex-1`}>
          <View style={[tw`flex-row items-center gap-2 px-2`, { paddingTop: insets.top + 8 }]}>
            <IconButton icon={X} label="Close" variant="glass" onPress={onClose} />
            <T numberOfLines={1} style={tw`min-w-0 flex-1 text-[15px] font-semibold text-white`}>
              {chatTitle(chat, me)}
            </T>
            <IconButton
              icon={Trash2}
              label="Remove"
              variant="glass"
              onPress={() => remove(item.id)}
            />
          </View>
          <View style={tw`flex-1 items-center justify-center`}>
            <Image source={{ uri: item.file.uri }} style={tw`h-full w-full`} contentFit="contain" />
            {video ? (
              <View
                style={tw`absolute size-16 items-center justify-center rounded-full bg-black/45`}
              >
                <Play size={30} color="#fff" fill="#fff" style={{ marginLeft: 3 }} />
              </View>
            ) : null}
          </View>
          {items.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={tw`gap-2 px-3 py-2`}
            >
              {items.map((x, i) => (
                <Press
                  key={x.id}
                  onPress={() => setCurrent(i)}
                  feedback={false}
                  style={[
                    tw`size-14 overflow-hidden rounded-lg`,
                    { borderWidth: 2, borderColor: i === current ? '#6d5dfc' : 'transparent' },
                  ]}
                >
                  <Image
                    source={{ uri: x.file.uri }}
                    style={tw`h-full w-full`}
                    contentFit="cover"
                  />
                </Press>
              ))}
              <Press
                accessibilityLabel="Add more"
                onPress={async () => {
                  const more = await pickMedia();
                  if (more.length)
                    setItems((cur) => [
                      ...cur,
                      ...more.map((file, i) => ({ id: `${Date.now()}-${i}`, file, caption: '' })),
                    ]);
                }}
                style={tw`size-14 items-center justify-center rounded-lg border border-white/30`}
              >
                <Icon icon={Plus} size={22} color="#fff" />
              </Press>
            </ScrollView>
          ) : null}
          <View
            style={[
              tw`flex-row items-end gap-2 px-3 pt-1`,
              { paddingBottom: Math.max(12, insets.bottom + 8) },
            ]}
          >
            <TextInput
              value={item.caption}
              onChangeText={(v) =>
                setItems((cur) => cur.map((x) => (x.id === item.id ? { ...x, caption: v } : x)))
              }
              placeholder="Add a caption…"
              placeholderTextColor="rgba(255,255,255,0.55)"
              maxLength={MAX_CAPTION_LENGTH}
              multiline
              style={[
                tw`min-h-12 flex-1 rounded-3xl px-4 py-3 text-[15px] text-white`,
                { backgroundColor: 'rgba(255,255,255,0.12)', maxHeight: 120 },
              ]}
            />
            <IconButton
              icon={SendIcon}
              label="Send"
              variant="brand"
              size="lg"
              onPress={() => onSend(items.map(({ file, caption }) => ({ file, caption })))}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Portal>
  );
}
