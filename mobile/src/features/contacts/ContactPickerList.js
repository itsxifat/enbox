/**
 * Searchable list of my contacts with round checkboxes or single tap (status privacy, block
 * picker…) — web features/contacts/ContactPickerList.tsx. Renders plain rows (it lives
 * inside scroll views and sheets).
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Contact as ContactIcon } from 'lucide-react-native';
import { userDisplayName } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { CheckCircle, EmptyState, ListItemSkeleton, Press, SearchInput, T } from '@/components/ui';
import { matchesUser, useContactList } from '@/stores/contacts';
import { useTheme } from '@/theme';

export function ContactPickerList({
  mode = 'multi',
  selected,
  onToggle,
  exclude,
  emptyText = 'Contacts you save appear here.',
  style,
  autoFocus,
}) {
  const { tw } = useTheme();
  const { items, loaded, error } = useContactList();
  const [query, setQuery] = useState('');
  const visible = useMemo(
    () =>
      items
        .filter((c) => !exclude?.has(c.user.id) && matchesUser(c.user, query))
        .map((c) => c.user),
    [items, exclude, query],
  );

  return (
    <View style={style}>
      <View style={tw`px-3 pt-1 pb-2`}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search contacts"
          autoFocus={autoFocus}
        />
      </View>
      {!loaded ? (
        error ? (
          <EmptyState
            compact
            icon={ContactIcon}
            title="Couldn't load contacts"
            description={error}
          />
        ) : (
          <ListItemSkeleton count={5} />
        )
      ) : visible.length === 0 ? (
        <EmptyState
          compact
          icon={ContactIcon}
          title={query ? 'No matching contacts' : 'No contacts yet'}
          description={query ? `Nothing matches “${query}”.` : emptyText}
        />
      ) : (
        <View accessibilityLabel="Contacts">
          {visible.map((u) => {
            const isSel = !!selected?.has(u.id);
            return (
              <Press
                key={u.id}
                accessibilityRole={mode === 'multi' ? 'checkbox' : 'button'}
                accessibilityState={mode === 'multi' ? { checked: isSel } : undefined}
                onPress={() => onToggle(u, mode === 'multi' ? !isSel : true)}
                style={tw`flex-row items-center gap-3 px-4 py-2.5`}
              >
                <UserAvatar user={u} size="md" />
                <View style={tw`min-w-0 flex-1`}>
                  <T numberOfLines={1} style={tw`text-[15.5px]`}>
                    {userDisplayName(u)}
                  </T>
                  <T numberOfLines={1} style={tw`text-[13px] text-muted`}>
                    {u.about || `@${u.username}`}
                  </T>
                </View>
                {mode === 'multi' ? <CheckCircle checked={isSel} size={20} /> : null}
              </Press>
            );
          })}
        </View>
      )}
    </View>
  );
}
