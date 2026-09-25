/** /updates/channels/new — create a channel (name, description, icon, visibility, reactions). */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { X } from 'lucide-react';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  createChannelSchema,
  type ID,
} from '@enbox/shared';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, IconButton, Input, RadioGroup, Textarea, toast } from '@/components/ui';
import { EditableAvatar } from '@/features/groups/shared/EditableAvatar';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { fieldErrors } from '@/lib/api';
import { validate } from '@/lib/forms';
import { createChannel } from './channelApi';

export function NewChannelPane() {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState<{ id: ID; url: string } | null>(null);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [reactions, setReactions] = useState<'all' | 'quick' | 'none'>('all');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
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
      void navigate(`/updates/channels/${chat.id}`, { replace: true });
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <PaneHeader
        title="New channel"
        back={desktop ? undefined : '/updates'}
        border
        actions={
          desktop ? (
            <IconButton icon={X} label="Cancel" onClick={() => void navigate('/updates')} />
          ) : undefined
        }
      />
      <form
        onSubmit={(e) => void submit(e)}
        className="min-h-0 flex-1 overflow-y-auto pb-28 scrollbar-thin"
        aria-label="Channel details"
      >
        <div className="mx-auto flex w-full max-w-lg flex-col px-6 pt-8">
          <div className="flex flex-col items-center text-center">
            <EditableAvatar
              src={avatar?.url}
              name={name || 'Channel'}
              kind="channel"
              size={112}
              label={avatar ? 'Change channel icon' : 'Add channel icon'}
              onUploaded={(m) => setAvatar({ id: m.id, url: m.url })}
              onRemove={() => setAvatar(null)}
            />
            <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-muted">
              Channels are a one-way tool to share updates with lots of people. Followers can't see
              each other, and only admins post.
            </p>
          </div>
          <div className="mt-6 flex flex-col gap-4">
            <Input
              label="Channel name"
              aside={`${Array.from(name).length}/${MAX_GROUP_NAME_LENGTH}`}
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, MAX_GROUP_NAME_LENGTH))}
              placeholder="e.g. Trail Running Daily"
              error={errors.name}
              autoFocus
            />
            <Textarea
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
              placeholder="Tell people what your channel is about"
              rows={3}
              autoResize
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
          </div>
        </div>
      </form>
      <div className="shrink-0 border-t border-line bg-surface px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-lg">
          <Button fullWidth size="lg" loading={busy} onClick={() => void submit()}>
            Create channel
          </Button>
        </div>
      </div>
    </div>
  );
}
