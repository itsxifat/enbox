/**
 * Emoji panel for the composer — the phone's answer to the web picker (emoji-picker-react,
 * which on a phone opened *on top of* the soft keyboard in a fixed 8-column box).
 *
 * - Replaces the keyboard: the composer renders it at the keyboard's last height, so toggling
 *   😀 ⇄ ⌨ never moves the conversation (see Composer).
 * - Responsive grid: the column count follows the panel width (phones, tablets, landscape,
 *   split screen) and cells stay square with a readable emoji size.
 * - Same data/categories/order as the web picker, recents first ("Recently Used"), keyword
 *   search, skin tones (a default tone, and long-press any person emoji for one-off tones),
 *   a category bar that tracks the scroll position and a backspace key.
 * - Search: focusing the field switches to a compact strip (field + one row of results) that
 *   sits above the keyboard; `onSearchFocus` tells the composer.
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  Cat,
  Clock3,
  Delete,
  Flag,
  Hamburger,
  Lightbulb,
  Music,
  Search,
  Smile,
  TramFront,
  Volleyball,
  X,
} from 'lucide-react-native';
import { Icon } from '@/components/icons';
import { Press, T } from '@/components/ui';
import { alpha, useTheme } from '@/theme';
import {
  EMOJI_CATEGORIES,
  SKIN_TONES,
  SKIN_TONE_SWATCHES,
  recentEntries,
  rememberEmoji,
  searchEmoji,
  setSkinTone,
  useRecentEmoji,
  useSkinTone,
  variationsOf,
  withTone,
} from './model';

const CATEGORY_ICONS = {
  recent: Clock3,
  smileys_people: Smile,
  animals_nature: Cat,
  food_drink: Hamburger,
  travel_places: TramFront,
  activities: Volleyball,
  objects: Lightbulb,
  symbols: Music,
  flags: Flag,
};

const HEADER_H = 34;
/** Target cell size; the real size stretches so the columns fill the width exactly. */
const TARGET_CELL = 46;
const MIN_COLS = 7;

function useGrid(width, sections) {
  return useMemo(() => {
    if (!width) return { cols: 8, cell: TARGET_CELL, items: [], offsets: [], starts: {} };
    const cols = Math.max(MIN_COLS, Math.floor(width / TARGET_CELL));
    const cell = width / cols;
    const items = [];
    const offsets = [];
    const starts = {};
    let y = 0;
    for (const s of sections) {
      starts[s.id] = items.length;
      items.push({ type: 'header', key: `h:${s.id}`, title: s.name, section: s.id });
      offsets.push(y);
      y += HEADER_H;
      for (let i = 0; i < s.emojis.length; i += cols) {
        items.push({
          type: 'row',
          key: `r:${s.id}:${i}`,
          emojis: s.emojis.slice(i, i + cols),
          section: s.id,
        });
        offsets.push(y);
        y += cell;
      }
    }
    return { cols, cell, items, offsets, starts, total: y };
  }, [width, sections]);
}

const EmojiCell = memo(function EmojiCell({ e, tone, size, onPick, onLong }) {
  const { c } = useTheme();
  const char = withTone(e, tone);
  return (
    <Pressable
      onPress={() => onPick(char)}
      onLongPress={e.variations ? () => onLong(e) : undefined}
      delayLongPress={320}
      accessibilityRole="button"
      accessibilityLabel={e.keywords.split(',').pop() || char}
      style={({ pressed }) => ({
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        backgroundColor: pressed ? c.hover : 'transparent',
      })}
    >
      <T
        style={{
          fontSize: Math.min(32, Math.round(size * 0.62)),
          lineHeight: Math.round(size * 0.82),
        }}
      >
        {char}
      </T>
      {e.variations ? (
        <View
          style={{
            position: 'absolute',
            right: size * 0.12,
            bottom: size * 0.12,
            width: 0,
            height: 0,
            borderStyle: 'solid',
            borderLeftWidth: 4,
            borderTopWidth: 4,
            borderLeftColor: 'transparent',
            borderTopColor: 'transparent',
            borderRightColor: alpha(c.muted, 0.5),
            borderBottomColor: alpha(c.muted, 0.5),
            borderRightWidth: 0,
            borderBottomWidth: 0,
          }}
        />
      ) : null}
    </Pressable>
  );
});

export function EmojiPanel({ height, onPick, onBackspace, onSearchFocus, searching }) {
  const { tw, c, shadow } = useTheme();
  // Full-width in the composer and the reaction sheet; onLayout refines it (split screen).
  const [width, setWidth] = useState(useWindowDimensions().width);
  const [active, setActive] = useState(null);
  const [query, setQuery] = useState('');
  const [variants, setVariants] = useState(null);
  const [toneOpen, setToneOpen] = useState(false);
  const recent = useRecentEmoji();
  const tone = useSkinTone();
  const list = useRef(null);
  const input = useRef(null);

  const sections = useMemo(() => {
    const out = [];
    if (recent.length)
      out.push({ id: 'recent', name: 'Recently Used', emojis: recentEntries(recent) });
    return [...out, ...EMOJI_CATEGORIES];
  }, [recent]);
  const grid = useGrid(width, sections);
  const results = useMemo(() => searchEmoji(query), [query]);
  const current = active ?? sections[0]?.id;

  const pick = useCallback(
    (char) => {
      rememberEmoji(char);
      onPick(char);
    },
    [onPick],
  );
  const onLong = useCallback((e) => setVariants(e), []);

  const jumpTo = (id) => {
    const index = grid.starts[id];
    if (index === undefined) return;
    setActive(id);
    list.current?.scrollToOffset({ offset: grid.offsets[index], animated: false });
  };

  const onViewable = useRef(({ viewableItems }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.item?.section) setActive(first.item.section);
  }).current;

  const renderItem = useCallback(
    ({ item }) =>
      item.type === 'header' ? (
        <View style={[tw`justify-end px-3 pb-1`, { height: HEADER_H }]}>
          <T style={tw`text-[14px] font-semibold text-fg`}>{item.title}</T>
        </View>
      ) : (
        <View style={tw`flex-row`}>
          {item.emojis.map((e) => (
            <EmojiCell key={e.u} e={e} tone={tone} size={grid.cell} onPick={pick} onLong={onLong} />
          ))}
        </View>
      ),
    [tw, tone, grid.cell, pick, onLong],
  );

  const searchField = (
    <View style={tw`flex-row items-center gap-2 px-3 pt-2`}>
      <View
        style={[
          tw`h-9 flex-1 flex-row items-center rounded-full bg-surface-2 px-3`,
          searching ? { boxShadow: `0px 0px 0px 2px ${alpha(c.brand, 0.3)}` } : null,
        ]}
      >
        <Icon icon={Search} size={16} color={searching ? c['brand-ink'] : c.subtle} />
        <TextInput
          ref={input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search emoji"
          placeholderTextColor={c.subtle}
          selectionColor={alpha(c.brand, 0.5)}
          cursorColor={c.brand}
          onFocus={() => onSearchFocus?.(true)}
          onBlur={() => onSearchFocus?.(false)}
          style={{ flex: 1, height: '100%', marginLeft: 8, fontSize: 15, color: c.fg, padding: 0 }}
          returnKeyType="done"
        />
        {query ? (
          <Press
            onPress={() => setQuery('')}
            style={tw`size-6 items-center justify-center rounded-full`}
          >
            <Icon icon={X} size={14} color={c.muted} />
          </Press>
        ) : null}
      </View>
      {!searching ? (
        <Press
          accessibilityLabel="Skin tone"
          onPress={() => setToneOpen((o) => !o)}
          style={tw`size-9 items-center justify-center rounded-full`}
        >
          <View
            style={[
              tw`size-5 rounded-md`,
              {
                backgroundColor:
                  SKIN_TONE_SWATCHES[SKIN_TONES.indexOf(tone)] ?? SKIN_TONE_SWATCHES[0],
              },
            ]}
          />
        </Press>
      ) : null}
    </View>
  );

  // Compact search strip above the keyboard.
  if (searching) {
    return (
      <View style={tw`bg-surface pb-1`}>
        {searchField}
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={tw`px-2 py-1`}
          style={{ height: 52 }}
        >
          {query && !results.length ? (
            <T style={tw`self-center px-2 text-[14px] text-muted`}>No emoji found</T>
          ) : (
            (query ? results : recentEntries(recent)).map((e) => (
              <EmojiCell key={e.u} e={e} tone={tone} size={44} onPick={pick} onLong={onLong} />
            ))
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      style={[tw`bg-surface`, { height }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {searchField}
      {toneOpen ? (
        <View style={tw`flex-row items-center justify-center gap-3 px-3 pt-2`}>
          {SKIN_TONES.map((t, i) => (
            <Press
              key={t || 'neutral'}
              accessibilityLabel={`Skin tone ${i + 1}`}
              onPress={() => {
                setSkinTone(t);
                setToneOpen(false);
              }}
              style={[
                tw`size-8 items-center justify-center rounded-full`,
                t === tone ? { borderWidth: 2, borderColor: c.brand } : null,
              ]}
            >
              <View style={[tw`size-5 rounded-md`, { backgroundColor: SKIN_TONE_SWATCHES[i] }]} />
            </Press>
          ))}
        </View>
      ) : null}

      {/* Category bar (+ backspace). */}
      <View style={tw`mt-1 flex-row items-center border-b border-line px-1`}>
        {sections.map((s) => {
          const on = s.id === current;
          return (
            <Press
              key={s.id}
              accessibilityLabel={s.name}
              onPress={() => jumpTo(s.id)}
              style={tw`h-10 flex-1 items-center justify-center`}
            >
              <Icon icon={CATEGORY_ICONS[s.id]} size={20} color={on ? c['brand-ink'] : c.muted} />
              {on ? (
                <View
                  style={tw`absolute right-2 bottom-0 left-2 h-[3px] rounded-t-full bg-brand`}
                />
              ) : null}
            </Press>
          );
        })}
        {onBackspace ? (
          <Press
            accessibilityLabel="Backspace"
            onPress={onBackspace}
            onLongPress={onBackspace}
            style={tw`h-10 w-11 items-center justify-center`}
          >
            <Icon icon={Delete} size={22} color={c.muted} />
          </Press>
        ) : null}
      </View>

      {query ? (
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="always"
          contentContainerStyle={tw`flex-row flex-wrap`}
        >
          {results.length ? (
            results.map((e) => (
              <EmojiCell
                key={e.u}
                e={e}
                tone={tone}
                size={grid.cell}
                onPick={pick}
                onLong={onLong}
              />
            ))
          ) : (
            <T style={tw`w-full py-8 text-center text-[14px] text-muted`}>No emoji found</T>
          )}
        </ScrollView>
      ) : (
        <FlatList
          ref={list}
          nestedScrollEnabled
          data={grid.items}
          keyExtractor={(i) => i.key}
          renderItem={renderItem}
          getItemLayout={(_, index) => ({
            length: grid.items[index]?.type === 'header' ? HEADER_H : grid.cell,
            offset: grid.offsets[index] ?? 0,
            index,
          })}
          initialNumToRender={12}
          maxToRenderPerBatch={16}
          windowSize={7}
          keyboardShouldPersistTaps="always"
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
          contentContainerStyle={tw`pb-2`}
        />
      )}

      {variants ? (
        <Pressable style={tw`absolute inset-0`} onPress={() => setVariants(null)}>
          <View
            style={[
              tw`absolute top-14 flex-row self-center rounded-2xl border border-line bg-elevated p-1`,
              shadow.elevated,
            ]}
          >
            {variationsOf(variants).map((char) => (
              <Press
                key={char}
                onPress={() => {
                  setVariants(null);
                  pick(char);
                }}
                style={tw`size-12 items-center justify-center rounded-xl`}
              >
                <T style={{ fontSize: 30, lineHeight: 38 }}>{char}</T>
              </Press>
            ))}
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
