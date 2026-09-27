/**
 * Create a community (web features/communities/NewCommunityPane.tsx): name, description and
 * icon, then add existing groups you admin and/or name new groups to create inside it.
 */
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Megaphone, Plus, UsersRound, X } from 'lucide-react-native';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  createCommunitySchema,
} from '@enbox/shared';
import { Icon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Avatar, Button, IconButton, Input, T, Textarea, toast } from '@/components/ui';
import { EditableAvatar } from '@/features/groups/shared/EditableAvatar';
import { errorMessage, fieldErrors } from '@/lib/api';
import { validate } from '@/lib/forms';
import { useChats } from '@/stores/chats';
import { useCommunities } from '@/stores/communities';
import { useTheme } from '@/theme';
import { GroupCheckRow, linkableGroups } from './AddGroupsView';

export function NewCommunity() {
  const { tw, c: col, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [step, setStep] = useState('info');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState(null);
  const [errors, setErrors] = useState({});
  const [picked, setPicked] = useState(new Set());
  const [newGroups, setNewGroups] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const byId = useChats((s) => s.byId);
  const groups = useMemo(() => linkableGroups(byId), [byId]);

  const next = () => {
    const v = validate(createCommunitySchema, {
      name: name.trim(),
      description: description.trim() || undefined,
    });
    if (!v.ok) {
      setErrors({ ...v.errors, ...(name.trim() ? {} : { name: 'Give your community a name' }) });
      return;
    }
    setErrors({});
    setStep('groups');
  };

  const addDraft = () => {
    const n = draft.trim();
    if (!n) return;
    if (newGroups.includes(n)) {
      toast.info('You already added a group with that name');
      return;
    }
    setNewGroups((l) => [...l, n.slice(0, MAX_GROUP_NAME_LENGTH)]);
    setDraft('');
  };

  const create = async () => {
    setBusy(true);
    const store = useCommunities.getState();
    try {
      const c = await store.createCommunity({
        name: name.trim(),
        description: description.trim() || undefined,
        avatarMediaId: avatar?.id,
        groupIds: [...picked],
      });
      for (const [i, n] of newGroups.entries()) {
        try {
          await store.createCommunityGroup(c.id, { name: n, memberIds: [] });
        } catch (e) {
          toast.error(`Couldn't create “${n}”: ${errorMessage(e)}`);
          if (i === 0) break;
        }
      }
      if (picked.size)
        for (const id of picked) useChats.getState().applyChatUpdate(id, { communityId: c.id });
      await store.refreshCommunity(c.id).catch(() => undefined);
      toast.success(`Community “${c.name}” created`);
      router.replace(`/communities/${c.id}`);
    } catch (e) {
      const fe = fieldErrors(e);
      if (Object.keys(fe).length) {
        setErrors(fe);
        setStep('info');
      }
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'info')
    return (
      <View style={tw`flex-1 bg-surface`}>
        <PaneHeader title="New community" back="/communities" />
        <KeyboardAwareScrollView
          style={tw`min-h-0 flex-1`}
          contentContainerStyle={tw`items-center px-6 pt-8 pb-28`}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
        >
          <EditableAvatar
            src={avatar?.url}
            name={name || 'Community'}
            kind="community"
            size={112}
            label={avatar ? 'Change community icon' : 'Add community icon'}
            onUploaded={(m) => setAvatar({ id: m.id, url: m.url })}
            onRemove={() => setAvatar(null)}
          />
          <T
            style={[
              tw`mt-4 text-center text-[14px] text-muted`,
              { maxWidth: 384, lineHeight: 22.75 },
            ]}
          >
            Bring members together in topic-based groups, and send announcements that reach
            everyone.
          </T>
          <View style={tw`mt-6 w-full gap-4`}>
            <Input
              label="Community name"
              aside={`${Array.from(name).length}/${MAX_GROUP_NAME_LENGTH}`}
              value={name}
              onChangeText={(v) => setName(v.slice(0, MAX_GROUP_NAME_LENGTH))}
              placeholder="e.g. Bay Area Outdoors"
              error={errors.name}
              autoFocus
            />
            <Textarea
              label="Description"
              value={description}
              onChangeText={(v) => setDescription(v.slice(0, MAX_DESCRIPTION_LENGTH))}
              placeholder="What's this community about? Share its purpose and rules."
              minRows={4}
              maxRows={8}
              error={errors.description}
            />
          </View>
        </KeyboardAwareScrollView>
        <View
          pointerEvents="box-none"
          style={[tw`absolute right-5`, { bottom: Math.max(20, insets.bottom + 8) }]}
        >
          <IconButton
            icon={ArrowRight}
            label="Next"
            variant="brand"
            size="xl"
            shape="square"
            style={shadow.elevated}
            onPress={next}
          />
        </View>
      </View>
    );

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="Add groups" subtitle={name} back={() => setStep('info')} />
      <ScrollView
        style={tw`min-h-0 flex-1 bg-app`}
        contentContainerStyle={tw`pb-28`}
        keyboardShouldPersistTaps="handled"
      >
        <View style={tw`bg-surface px-5 py-4`}>
          <View style={tw`flex-row items-center gap-3`}>
            <View style={tw`size-11 items-center justify-center rounded-[12px] bg-brand-soft`}>
              <Icon icon={Megaphone} size={20} color={col['brand-ink']} />
            </View>
            <View style={tw`min-w-0 flex-1`}>
              <T style={tw`text-[15.5px] font-medium`}>Announcements</T>
              <T style={tw`text-[13px] text-muted`}>
                Created automatically. Every member gets admin announcements here.
              </T>
            </View>
          </View>
        </View>

        <View style={tw`mt-2 bg-surface py-3`}>
          <T style={tw`px-5 pb-2 text-[14px] font-medium text-muted`}>Create new groups</T>
          {newGroups.map((n) => (
            <View key={n} style={tw`flex-row items-center gap-3 px-5 py-2`}>
              <Avatar name={n} kind="group" size="md" colorSeed={n} />
              <T numberOfLines={1} style={tw`min-w-0 flex-1 text-[15.5px] font-medium`}>
                {n}
              </T>
              <IconButton
                icon={X}
                label={`Don't create ${n}`}
                size="sm"
                onPress={() => setNewGroups((l) => l.filter((x) => x !== n))}
              />
            </View>
          ))}
          <View style={tw`flex-row items-center gap-2 px-5 pt-1`}>
            <Input
              value={draft}
              onChangeText={(v) => setDraft(v.slice(0, MAX_GROUP_NAME_LENGTH))}
              onSubmitEditing={addDraft}
              placeholder="New group name, e.g. General chat"
              accessibilityLabel="New group name"
              variant="filled"
              containerStyle={tw`flex-1`}
            />
            <Button variant="soft" leftIcon={Plus} disabled={!draft.trim()} onPress={addDraft}>
              Add
            </Button>
          </View>
        </View>

        <View style={tw`mt-2 bg-surface py-3`}>
          <T style={tw`px-5 pb-1 text-[14px] font-medium text-muted`}>Add existing groups</T>
          {groups.length ? (
            groups.map((g) => (
              <GroupCheckRow
                key={g.id}
                group={g}
                checked={picked.has(g.id)}
                onToggle={() =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (n.has(g.id)) n.delete(g.id);
                    else n.add(g.id);
                    return n;
                  })
                }
              />
            ))
          ) : (
            <View style={tw`flex-row items-center gap-3 px-5 py-2`}>
              <Icon icon={UsersRound} size={18} color={col.muted} />
              <T style={tw`min-w-0 flex-1 text-[14px] text-muted`}>
                Groups you admin that aren't in a community will show up here.
              </T>
            </View>
          )}
        </View>
      </ScrollView>
      <View
        style={[
          tw`absolute inset-x-3 rounded-xl bg-surface-2 px-4 py-3`,
          { bottom: Math.max(12, insets.bottom) },
          shadow.elevated,
        ]}
      >
        <Button fullWidth size="lg" loading={busy} onPress={() => void create()}>
          Create community
        </Button>
      </View>
    </View>
  );
}
