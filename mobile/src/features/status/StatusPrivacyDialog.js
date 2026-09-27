/**
 * Status privacy (web features/status/StatusPrivacyDialog.tsx): My contacts / My contacts
 * except… / Only share with…, with a contacts picker for the lists.
 */
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { userDisplayName } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { Icon } from '@/components/icons';
import {
  Button,
  EmptyState,
  ListItemSkeleton,
  Modal,
  Press,
  SearchInput,
  T,
  toast,
} from '@/components/ui';
import { SelectRow } from '@/features/calls/ui/ParticipantPicker';
import { api, errorMessage } from '@/lib/api';
import { useAuth, useMe } from '@/stores/auth';
import { useTheme } from '@/theme';

const OPTIONS = [
  { value: 'contacts', label: 'My contacts', hint: 'Everyone you saved as a contact' },
  {
    value: 'contacts_except',
    label: 'My contacts except…',
    hint: 'Hide your status from some contacts',
  },
  { value: 'only_share_with', label: 'Only share with…', hint: 'Only the contacts you pick' },
];

export function StatusPrivacyDialog({ open, onClose }) {
  const { tw, c } = useTheme();
  const me = useMe();
  const settings = me?.settings;
  const [privacy, setPrivacy] = useState(settings?.statusPrivacy ?? 'contacts');
  const [except, setExcept] = useState(settings?.statusExcludeUserIds ?? []);
  const [only, setOnly] = useState(settings?.statusOnlyShareWithUserIds ?? []);
  const [picking, setPicking] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !settings) return;
    setPrivacy(settings.statusPrivacy);
    setExcept(settings.statusExcludeUserIds);
    setOnly(settings.statusOnlyShareWithUserIds);
    setPicking(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.patch('/api/me/settings', {
        statusPrivacy: privacy,
        statusExcludeUserIds: except,
        statusOnlyShareWithUserIds: only,
      });
      useAuth.getState().patchUser({ settings: next });
      toast.success('Status privacy updated');
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (picking) {
    return (
      <ContactsPicker
        open={open}
        title={picking === 'contacts_except' ? 'Hide status from…' : 'Share status with…'}
        initial={picking === 'contacts_except' ? except : only}
        onCancel={() => setPicking(null)}
        onDone={(ids) => {
          if (picking === 'contacts_except') setExcept(ids);
          else setOnly(ids);
          setPrivacy(picking);
          setPicking(null);
        }}
      />
    );
  }

  const count = (v) =>
    v === 'contacts_except' ? except.length : v === 'only_share_with' ? only.length : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Status privacy"
      description="Who can see my status updates"
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={privacy === 'only_share_with' && only.length === 0}
            onPress={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <View accessibilityRole="radiogroup" style={tw`-mx-2`}>
        {OPTIONS.map((o) => {
          const checked = privacy === o.value;
          const n = count(o.value);
          return (
            <View key={o.value} style={tw`flex-row items-center rounded-2xl`}>
              <Press
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                onPress={() => {
                  setPrivacy(o.value);
                  if (o.value !== 'contacts' && count(o.value) === 0) setPicking(o.value);
                }}
                style={tw`min-w-0 flex-1 flex-row items-center gap-3 rounded-2xl px-2 py-2.5`}
              >
                <View
                  style={[
                    tw`size-5 items-center justify-center rounded-full border-2`,
                    { borderColor: checked ? c.brand : c['line-strong'] },
                  ]}
                >
                  {checked ? <View style={tw`size-2.5 rounded-full bg-brand`} /> : null}
                </View>
                <View style={tw`min-w-0 flex-1`}>
                  <T style={tw`text-[15px]`}>{o.label}</T>
                  <T style={tw`text-[13px] text-muted`}>
                    {o.value === 'contacts'
                      ? o.hint
                      : n
                        ? `${n} contact${n === 1 ? '' : 's'} ${o.value === 'contacts_except' ? 'excluded' : 'selected'}`
                        : o.hint}
                  </T>
                </View>
              </Press>
              {o.value !== 'contacts' ? (
                <Press
                  accessibilityLabel={`Choose contacts for "${o.label}"`}
                  onPress={() => setPicking(o.value)}
                  style={tw`mr-1 size-9 items-center justify-center rounded-full`}
                >
                  <Icon icon={ChevronRight} size={18} color={c.muted} />
                </Press>
              ) : null}
            </View>
          );
        })}
      </View>
      <T style={[tw`mt-3 text-[13px] text-subtle`, { lineHeight: 21 }]}>
        Changes to your privacy settings won't affect status updates that you've sent already.
      </T>
    </Modal>
  );
}

function ContactsPicker({ open, title, initial, onCancel, onDone }) {
  const { tw } = useTheme();
  const [contacts, setContacts] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(initial);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .get('/api/contacts')
      .then((c) => alive && setContacts(c))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (contacts ?? [])
      .filter((c) => !c.user.isDeleted)
      .filter(
        (c) =>
          !q || userDisplayName(c.user).toLowerCase().includes(q) || c.user.username.includes(q),
      )
      .sort((a, b) => userDisplayName(a.user).localeCompare(userDisplayName(b.user)));
  }, [contacts, query]);

  const all = list.length > 0 && list.every((c) => selected.includes(c.user.id));
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={`${selected.length} selected`}
      bodyStyle={tw`px-0 py-0`}
      footer={
        <>
          <Button variant="ghost" onPress={onCancel}>
            Back
          </Button>
          <Button onPress={() => onDone(selected)}>Done</Button>
        </>
      }
    >
      <View style={tw`flex-row items-center gap-2 px-5 pb-2`}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search contacts"
          style={tw`flex-1`}
        />
        {list.length ? (
          <Press
            feedback={false}
            onPress={() =>
              setSelected((s) =>
                all
                  ? s.filter((id) => !list.some((c) => c.user.id === id))
                  : [...new Set([...s, ...list.map((c) => c.user.id)])],
              )
            }
          >
            <T style={tw`text-[13px] font-semibold text-brand-ink`}>
              {all ? 'Clear' : 'Select all'}
            </T>
          </Press>
        ) : null}
      </View>
      <View style={tw`min-h-48 pb-2`}>
        {error ? (
          <EmptyState title="Couldn't load contacts" description={error} compact />
        ) : !contacts ? (
          <ListItemSkeleton count={5} />
        ) : !list.length ? (
          <EmptyState title={query ? 'No matches' : 'No contacts yet'} compact />
        ) : (
          list.map((c) => (
            <SelectRow
              key={c.user.id}
              checked={selected.includes(c.user.id)}
              onChange={(on) =>
                setSelected((s) => (on ? [...s, c.user.id] : s.filter((x) => x !== c.user.id)))
              }
              leading={<UserAvatar user={c.user} size="md" />}
              title={userDisplayName(c.user)}
              subtitle={c.user.about ?? `@${c.user.username}`}
            />
          ))
        )}
      </View>
    </Modal>
  );
}
