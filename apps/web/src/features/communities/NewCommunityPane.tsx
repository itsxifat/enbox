/**
 * /communities/new — create a community: name, description and icon, then add existing
 * groups you admin and/or name new groups to create inside it.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Megaphone, Plus, UsersRound, X } from 'lucide-react';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  chatTitle,
  createCommunitySchema,
  type ID,
} from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Avatar, Button, IconButton, Input, Textarea, toast } from '@/components/ui';
import { EditableAvatar } from '@/features/groups/shared/EditableAvatar';
import { RoundCheck } from '@/features/groups/shared/UserPicker';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { errorMessage, fieldErrors } from '@/lib/api';
import { validate } from '@/lib/forms';
import { useChats } from '@/stores/chats';
import { useCommunities } from '@/stores/communities';
import { linkableGroups } from './AddGroupsView';

export function NewCommunityPane() {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const [step, setStep] = useState<'info' | 'groups'>('info');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState<{ id: ID; url: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<ID>>(new Set());
  const [newGroups, setNewGroups] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const byId = useChats((s) => s.byId);
  const groups = useMemo(() => linkableGroups(byId), [byId]);

  const next = (e?: FormEvent) => {
    e?.preventDefault();
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
      void navigate(`/communities/${c.id}`, { replace: true });
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
      <div className="relative flex min-h-0 flex-1 flex-col bg-surface">
        <PaneHeader
          title="New community"
          back={desktop ? undefined : '/communities'}
          border
          actions={
            desktop ? (
              <IconButton icon={X} label="Cancel" onClick={() => void navigate('/communities')} />
            ) : undefined
          }
        />
        <form
          onSubmit={next}
          className="min-h-0 flex-1 overflow-y-auto pb-28"
          aria-label="Community details"
        >
          <div className="mx-auto flex w-full max-w-lg flex-col items-center px-6 pt-8">
            <EditableAvatar
              src={avatar?.url}
              name={name || 'Community'}
              kind="community"
              size={112}
              label={avatar ? 'Change community icon' : 'Add community icon'}
              onUploaded={(m) => setAvatar({ id: m.id, url: m.url })}
              onRemove={() => setAvatar(null)}
            />
            <p className="mt-4 max-w-sm text-center text-[14px] leading-relaxed text-muted">
              Bring members together in topic-based groups, and send announcements that reach
              everyone.
            </p>
            <div className="mt-6 flex w-full flex-col gap-4">
              <Input
                label="Community name"
                aside={`${Array.from(name).length}/${MAX_GROUP_NAME_LENGTH}`}
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, MAX_GROUP_NAME_LENGTH))}
                placeholder="e.g. Bay Area Outdoors"
                error={errors.name}
                autoFocus
              />
              <Textarea
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
                placeholder="What's this community about? Share its purpose and rules."
                rows={4}
                autoResize
                maxRows={8}
                error={errors.description}
              />
            </div>
          </div>
          <button type="submit" className="hidden" tabIndex={-1} aria-hidden />
        </form>
        <div className="pointer-events-none absolute right-5 bottom-[max(20px,env(safe-area-inset-bottom))]">
          <IconButton
            icon={ArrowRight}
            label="Next"
            variant="brand"
            size="xl"
            shape="square"
            className="pointer-events-auto shadow-elevated"
            onClick={() => next()}
          />
        </div>
      </div>
    );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-surface">
      <PaneHeader title="Add groups" subtitle={name} back={() => setStep('info')} border />
      <div className="min-h-0 flex-1 overflow-y-auto bg-app pb-28 scrollbar-thin">
        <div className="mx-auto w-full max-w-2xl">
          <section className="bg-surface px-5 py-4 lg:mt-4 lg:rounded-2xl">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-[28%] bg-brand-soft text-brand-ink">
                <Megaphone size={20} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[15.5px] font-medium text-fg">Announcements</p>
                <p className="text-[13px] text-muted">
                  Created automatically. Every member gets admin announcements here.
                </p>
              </div>
            </div>
          </section>

          <section className="mt-2 bg-surface py-3 lg:rounded-2xl" aria-label="New groups">
            <h3 className="px-5 pb-2 text-[14px] font-medium text-muted">Create new groups</h3>
            <ul>
              {newGroups.map((n) => (
                <li key={n} className="flex items-center gap-3 px-5 py-2">
                  <Avatar name={n} kind="group" size="md" colorSeed={n} />
                  <span className="min-w-0 flex-1 truncate text-[15.5px] font-medium text-fg">
                    {n}
                  </span>
                  <IconButton
                    icon={X}
                    label={`Don't create ${n}`}
                    size="sm"
                    onClick={() => setNewGroups((l) => l.filter((x) => x !== n))}
                  />
                </li>
              ))}
            </ul>
            <form
              className="flex items-center gap-2 px-5 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                addDraft();
              }}
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_GROUP_NAME_LENGTH))}
                placeholder="New group name, e.g. General chat"
                aria-label="New group name"
                variant="filled"
                containerClassName="flex-1"
              />
              <Button type="submit" variant="soft" leftIcon={Plus} disabled={!draft.trim()}>
                Add
              </Button>
            </form>
          </section>

          <section className="mt-2 bg-surface py-3 lg:rounded-2xl" aria-label="Existing groups">
            <h3 className="px-5 pb-1 text-[14px] font-medium text-muted">Add existing groups</h3>
            {groups.length ? (
              <ul>
                {groups.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={picked.has(g.id)}
                      aria-label={chatTitle(g)}
                      onClick={() =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (n.has(g.id)) n.delete(g.id);
                          else n.add(g.id);
                          return n;
                        })
                      }
                      className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                    >
                      <ChatAvatar chat={g} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15.5px] font-medium text-fg">
                          {chatTitle(g)}
                        </span>
                        <span className="block truncate text-[13px] text-muted">
                          {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}
                        </span>
                      </span>
                      <RoundCheck checked={picked.has(g.id)} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-3 px-5 py-2 text-[14px] text-muted">
                <UsersRound size={18} aria-hidden className="shrink-0" />
                Groups you admin that aren't in a community will show up here.
              </p>
            )}
          </section>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 border-t border-line bg-surface px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-2xl">
          <Button fullWidth size="lg" loading={busy} onClick={() => void create()}>
            Create community
          </Button>
        </div>
      </div>
    </div>
  );
}
