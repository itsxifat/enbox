/**
 * Multi-select people picker (web shared/UserPicker.tsx): selected chips on top, a search box,
 * then contacts / recent chats / search results with round checkboxes.
 */
import { useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { SearchX, UserRoundSearch, X } from 'lucide-react-native';
import { userDisplayName } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { ICON_STROKE_BOLD, Icon } from '@/components/icons';
import {
  CheckCircle,
  EmptyState,
  ListItemSkeleton,
  Press,
  SearchInput,
  Spinner,
  T,
} from '@/components/ui';
import { useTheme } from '@/theme';
import { isRemoteQuery, useCandidates } from './candidates';

export function RoundCheck({ checked }) {
  return <CheckCircle checked={checked} size={22} />;
}

function PickerRow({ user, checked, disabledReason, onToggle }) {
  const { tw } = useTheme();
  const name = userDisplayName(user);
  return (
    <Press
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabledReason }}
      accessibilityLabel={name}
      onPress={() => {
        if (!disabledReason) onToggle();
      }}
      feedback={!disabledReason}
      style={[tw`flex-row items-center gap-3 px-4 py-2`, disabledReason ? { opacity: 0.6 } : null]}
    >
      <UserAvatar user={user} size="md" />
      <View style={tw`min-w-0 flex-1`}>
        <T numberOfLines={1} style={tw`text-[15.5px] font-medium`}>
          {name}
        </T>
        <T numberOfLines={1} style={tw`text-[13px] text-muted`}>
          {disabledReason ?? (user.about || `@${user.username}`)}
        </T>
      </View>
      <RoundCheck checked={checked} />
    </Press>
  );
}

export function UserPicker({ selected, onToggle, query, onQueryChange, disabled, header, autoFocus }) {
  const { tw, c } = useTheme();
  const { sections, loading, searching } = useCandidates(query);
  const selectedIds = new Set(selected.map((u) => u.id));
  const searchRef = useRef(null);
  const empty = !loading && sections.length === 0;

  return (
    <View style={tw`min-h-0 flex-1`}>
      {selected.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={tw`flex-grow-0 border-b border-line`}
          contentContainerStyle={tw`gap-1 px-3 pt-3 pb-2`}
          keyboardShouldPersistTaps="handled"
        >
          {selected.map((u) => (
            <Press
              key={u.id}
              feedback={false}
              onPress={() => {
                onToggle(u);
                searchRef.current?.focus();
              }}
              accessibilityLabel={`Remove ${userDisplayName(u)}`}
              style={tw`w-[68px] items-center gap-1 rounded-xl py-1`}
            >
              <View>
                <UserAvatar user={u} size="lg" />
                <View
                  style={[
                    tw`absolute -right-0.5 -bottom-0.5 size-5 items-center justify-center rounded-full`,
                    { backgroundColor: c.subtle, borderWidth: 2, borderColor: c.surface },
                  ]}
                >
                  <Icon icon={X} size={12} strokeWidth={ICON_STROKE_BOLD} color={c.surface} />
                </View>
              </View>
              <T numberOfLines={1} style={tw`w-full text-center text-[12px] text-muted`}>
                {userDisplayName(u).split(' ')[0]}
              </T>
            </Press>
          ))}
        </ScrollView>
      ) : null}
      <View style={tw`px-3 py-2`}>
        <SearchInput
          ref={searchRef}
          value={query}
          onChange={onQueryChange}
          placeholder="Search name, username or phone"
          autoFocus={autoFocus}
        />
      </View>
      <ScrollView
        style={tw`min-h-0 flex-1`}
        contentContainerStyle={tw`pb-24`}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {header}
        {loading ? (
          <ListItemSkeleton count={6} />
        ) : empty ? (
          query.trim() ? (
            searching ? (
              <View style={tw`items-center p-8`}>
                <Spinner />
              </View>
            ) : (
              <EmptyState
                compact
                icon={SearchX}
                title="No results"
                description={
                  isRemoteQuery(query)
                    ? `No one matches “${query.trim()}”.`
                    : 'Type at least 3 characters of a username, or a full phone number, to find people on Enbox.'
                }
              />
            )
          ) : (
            <EmptyState
              compact
              icon={UserRoundSearch}
              title="Find people"
              description="Search by username or phone number to add people who aren't in your contacts yet."
            />
          )
        ) : (
          sections.map((section) => (
            <View key={section.id}>
              <T style={tw`px-4 pt-3 pb-1 text-[13px] font-semibold text-brand-ink`}>
                {section.title}
              </T>
              {section.users.map((u) => {
                const reason = disabled?.get(u.id);
                const checked = selectedIds.has(u.id);
                return (
                  <PickerRow
                    key={u.id}
                    user={u}
                    checked={checked || !!reason}
                    disabledReason={reason}
                    onToggle={() => onToggle(u)}
                  />
                );
              })}
              {section.id === 'search' && searching ? (
                <View style={tw`items-center py-3`}>
                  <Spinner size={18} />
                </View>
              ) : null}
            </View>
          ))
        )}
        {!empty && searching && !sections.some((s) => s.id === 'search') ? (
          <View style={tw`items-center py-3`}>
            <Spinner size={18} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
