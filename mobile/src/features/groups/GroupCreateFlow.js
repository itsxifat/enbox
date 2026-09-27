/**
 * Two-step "new group" flow (web GroupCreateFlow.tsx): pick members → name, icon,
 * description, disappearing timer and permissions → create. Used by /new/group and by
 * communities (`communityId`).
 */
import { useState } from 'react';
import { View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Check, ChevronRight, Clock3, ShieldCheck } from 'lucide-react-native';
import {
  DEFAULT_GROUP_SETTINGS,
  MAX_DESCRIPTION_LENGTH,
  MAX_GROUP_MEMBERS,
  MAX_GROUP_NAME_LENGTH,
  createGroupSchema,
  userDisplayName,
} from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { Icon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, IconButton, Input, Modal, Press, T, Textarea, toast } from '@/components/ui';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { validate } from '@/lib/forms';
import { useMe } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useTheme } from '@/theme';
import { GroupPermissionsFields } from './GroupPermissions';
import { AddResultModal, hasProblems } from './shared/AddResultModal';
import { createGroup } from './shared/chatActions';
import { DisappearingModal, disappearingLabel } from './shared/dialogs';
import { EditableAvatar } from './shared/EditableAvatar';
import { UserPicker } from './shared/UserPicker';

function SettingRow({ icon, label, value, onPress }) {
  const { tw, c } = useTheme();
  return (
    <Press onPress={onPress} style={tw`flex-row items-center gap-5 px-5 py-3.5`}>
      <Icon icon={icon} size={22} color={c.muted} />
      <View style={tw`min-w-0 flex-1`}>
        <T style={tw`text-[15.5px]`}>{label}</T>
        <T style={tw`text-[13px] text-muted`}>{value}</T>
      </View>
      <Icon icon={ChevronRight} size={18} color={c.subtle} />
    </Press>
  );
}

export function GroupCreateFlow({ communityId, communityName, onCancel, onCreated, backIcon = 'arrow' }) {
  const { tw, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const [step, setStep] = useState('members');
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState(null);
  const [timer, setTimer] = useState(me?.settings.defaultDisappearingSeconds ?? null);
  const [settings, setSettings] = useState({ ...DEFAULT_GROUP_SETTINGS });
  const [timerOpen, setTimerOpen] = useState(false);
  const [permsOpen, setPermsOpen] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const toggle = (u) =>
    setSelected((list) =>
      list.some((x) => x.id === u.id) ? list.filter((x) => x.id !== u.id) : [...list, u],
    );

  const finish = (chat) => {
    toast.success(`Group “${chat.name ?? name}” created`);
    onCreated(chat);
  };

  const submit = async () => {
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      avatarMediaId: avatar?.id,
      memberIds: selected.map((u) => u.id),
      disappearingSeconds: timer,
      settings,
    };
    const v = validate(createGroupSchema, body);
    if (!v.ok) {
      const errs = { ...v.errors };
      if (!body.name) errs.name = 'Give your group a name';
      setErrors(errs);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const r = communityId
        ? await api.post(`/api/communities/${communityId}/groups`, body)
        : await createGroup(body);
      if (communityId) useChats.getState().upsertChat(r.chat);
      if (hasProblems(r)) setResult(r);
      else finish(r.chat);
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      toast.error(fe.name ?? errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const fab = (icon, label, onPress, loading) => (
    <View
      pointerEvents="box-none"
      style={[tw`absolute right-5`, { bottom: Math.max(20, insets.bottom + 8) }]}
    >
      <IconButton
        icon={icon}
        label={label}
        variant="brand"
        size="xl"
        shape="square"
        loading={loading}
        style={shadow.elevated}
        onPress={onPress}
      />
    </View>
  );

  if (step === 'members') {
    return (
      <View style={tw`flex-1 bg-surface`}>
        <PaneHeader
          title={communityId ? 'New group in community' : 'New group'}
          subtitle={
            selected.length ? `${selected.length} of ${MAX_GROUP_MEMBERS - 1} selected` : 'Add members'
          }
          back={onCancel}
          backIcon={backIcon}
        />
        <UserPicker selected={selected} onToggle={toggle} query={query} onQueryChange={setQuery} />
        {fab(ArrowRight, selected.length ? 'Next' : 'Skip adding members', () => setStep('details'))}
      </View>
    );
  }

  const count = `${Array.from(name).length}/${MAX_GROUP_NAME_LENGTH}`;
  const adminOnly = Object.values(settings).filter(Boolean).length;

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title={communityId ? 'New group in community' : 'New group'}
        subtitle={communityName}
        back={() => setStep('members')}
      />
      <KeyboardAwareScrollView
        style={tw`min-h-0 flex-1 bg-app`}
        contentContainerStyle={tw`pb-28`}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <View style={tw`flex-row items-center gap-4 bg-surface px-5 pt-6 pb-5`}>
          <EditableAvatar
            src={avatar?.url}
            name={name || 'Group'}
            kind="group"
            size={72}
            label={avatar ? 'Change group icon' : 'Add group icon'}
            onUploaded={(m) => setAvatar({ id: m.id, url: m.url })}
            onRemove={() => setAvatar(null)}
          />
          <View style={tw`min-w-0 flex-1`}>
            <Input
              label="Group name"
              aside={count}
              value={name}
              onChangeText={(v) => setName(v.slice(0, MAX_GROUP_NAME_LENGTH))}
              placeholder="e.g. Weekend hiking"
              error={errors.name}
              autoFocus
            />
          </View>
        </View>
        <View style={tw`bg-surface px-5 pb-5`}>
          <Textarea
            label="Description (optional)"
            value={description}
            onChangeText={(v) => setDescription(v.slice(0, MAX_DESCRIPTION_LENGTH))}
            minRows={2}
            maxRows={5}
            placeholder="What's this group about?"
            error={errors.description}
          />
        </View>
        <View style={tw`mt-2 bg-surface py-1`}>
          <SettingRow
            icon={Clock3}
            label="Disappearing messages"
            value={disappearingLabel(timer)}
            onPress={() => setTimerOpen(true)}
          />
          <SettingRow
            icon={ShieldCheck}
            label="Group permissions"
            value={adminOnly ? `${adminOnly} admin-only` : 'All members'}
            onPress={() => setPermsOpen(true)}
          />
        </View>
        <View style={tw`mt-2 bg-surface px-5 py-4`}>
          <T style={tw`text-[14px] font-medium text-muted`}>Members: {selected.length + 1}</T>
          <View style={tw`mt-3 flex-row flex-wrap gap-y-3`}>
            {[
              { key: 'me', user: me ? { ...me, contactName: null } : null, label: 'You' },
              ...selected.map((u) => ({ key: u.id, user: u, label: userDisplayName(u).split(' ')[0] })),
            ].map((x) => (
              <View key={x.key} style={tw`w-[68px] items-center gap-1`}>
                <UserAvatar user={x.user} size="lg" />
                <T numberOfLines={1} style={tw`w-full text-center text-[12px] text-muted`}>
                  {x.label}
                </T>
              </View>
            ))}
          </View>
        </View>
      </KeyboardAwareScrollView>
      {fab(Check, 'Create group', () => void submit(), busy)}

      <DisappearingModal
        open={timerOpen}
        onClose={() => setTimerOpen(false)}
        current={timer}
        onSave={async (s) => setTimer(s)}
      />
      <Modal
        open={permsOpen}
        onClose={() => setPermsOpen(false)}
        title="Group permissions"
        description="Admins can change these later in group settings."
        footer={<Button onPress={() => setPermsOpen(false)}>Done</Button>}
      >
        <GroupPermissionsFields
          value={settings}
          onChange={(key, v) => setSettings((s) => ({ ...s, [key]: v }))}
        />
      </Modal>
      <AddResultModal
        result={result}
        name={result?.chat.name ?? name}
        kind="group"
        inviteCode={result?.chat.inviteCode ?? null}
        onClose={() => {
          const chat = result?.chat;
          setResult(null);
          if (chat) finish(chat);
        }}
      />
    </View>
  );
}
