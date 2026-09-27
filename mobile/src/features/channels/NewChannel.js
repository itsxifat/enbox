/** Create a channel (web features/channels/NewChannelPane.tsx): name, description, icon, visibility, reactions. */
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_DESCRIPTION_LENGTH, MAX_GROUP_NAME_LENGTH, createChannelSchema } from '@enbox/shared';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, Input, RadioGroup, T, Textarea, toast } from '@/components/ui';
import { EditableAvatar } from '@/features/groups/shared/EditableAvatar';
import { fieldErrors } from '@/lib/api';
import { validate } from '@/lib/forms';
import { useTheme } from '@/theme';
import { createChannel } from './channelApi';

export function NewChannel() {
  const { tw } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState(null);
  const [visibility, setVisibility] = useState('public');
  const [reactions, setReactions] = useState('all');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      avatarMediaId: avatar?.id,
      isPublic: visibility === 'public',
      reactions,
    };
    const v = validate(createChannelSchema, body);
    if (!v.ok) {
      setErrors({ ...v.errors, ...(body.name ? {} : { name: 'Give your channel a name' }) });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const chat = await createChannel(body);
      toast.success(`Channel “${chat.name}” created`);
      router.replace(`/updates/channels/${chat.id}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="New channel" back="/updates" />
      <KeyboardAwareScrollView
        style={tw`min-h-0 flex-1`}
        contentContainerStyle={tw`px-6 pt-8 pb-8`}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <View style={tw`items-center`}>
          <EditableAvatar
            src={avatar?.url}
            name={name || 'Channel'}
            kind="channel"
            size={112}
            label={avatar ? 'Change channel icon' : 'Add channel icon'}
            onUploaded={(m) => setAvatar({ id: m.id, url: m.url })}
            onRemove={() => setAvatar(null)}
          />
          <T
            style={[
              tw`mt-4 text-center text-[14px] text-muted`,
              { maxWidth: 384, lineHeight: 22.75 },
            ]}
          >
            Channels are a one-way tool to share updates with lots of people. Followers can't see
            each other, and only admins post.
          </T>
        </View>
        <View style={tw`mt-6 gap-4`}>
          <Input
            label="Channel name"
            aside={`${Array.from(name).length}/${MAX_GROUP_NAME_LENGTH}`}
            value={name}
            onChangeText={(v) => setName(v.slice(0, MAX_GROUP_NAME_LENGTH))}
            placeholder="e.g. Trail Running Daily"
            error={errors.name}
            autoFocus
          />
          <Textarea
            label="Description"
            value={description}
            onChangeText={(v) => setDescription(v.slice(0, MAX_DESCRIPTION_LENGTH))}
            placeholder="Tell people what your channel is about"
            minRows={3}
            maxRows={8}
            error={errors.description}
          />
          <RadioGroup
            label="Who can find it"
            value={visibility}
            onChange={setVisibility}
            options={[
              {
                value: 'public',
                label: 'Public',
                description: 'Listed in the directory. Anyone can preview and follow.',
              },
              {
                value: 'private',
                label: 'Private',
                description: 'Only people with the invite link can follow.',
              },
            ]}
          />
          <RadioGroup
            label="Follower reactions"
            value={reactions}
            onChange={setReactions}
            options={[
              { value: 'all', label: 'Any emoji' },
              { value: 'quick', label: 'Default emoji only' },
              { value: 'none', label: 'No reactions' },
            ]}
          />
        </View>
      </KeyboardAwareScrollView>
      <View
        style={[
          tw`mx-3 mt-2 rounded-xl bg-surface-2 px-4 py-3`,
          { marginBottom: Math.max(12, insets.bottom) },
        ]}
      >
        <Button fullWidth size="lg" loading={busy} onPress={() => void submit()}>
          Create channel
        </Button>
      </View>
    </View>
  );
}
