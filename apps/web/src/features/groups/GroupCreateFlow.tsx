/**
 * Two-step "new group" flow: pick members → name, icon, description, disappearing timer and
 * permissions → create. Used by /new/group (POST /api/groups) and by communities
 * (POST /api/communities/:id/groups via `communityId`).
 */
import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, ChevronRight, Clock3, ShieldCheck } from 'lucide-react';
import {
  DEFAULT_GROUP_SETTINGS,
  MAX_DESCRIPTION_LENGTH,
  MAX_GROUP_MEMBERS,
  MAX_GROUP_NAME_LENGTH,
  createGroupSchema,
  userDisplayName,
  type AddMembersResult,
  type ChatSummary,
  type GroupSettings,
  type ID,
  type UserPublic,
} from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, IconButton, Input, Modal, Textarea, toast } from '@/components/ui';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { validate } from '@/lib/forms';
import { useMe } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { GroupPermissionsFields } from './GroupPermissions';
import { AddResultModal, hasProblems } from './shared/AddResultModal';
import { createGroup } from './shared/chatActions';
import { DisappearingModal, disappearingLabel } from './shared/dialogs';
import { EditableAvatar } from './shared/EditableAvatar';
import { UserPicker } from './shared/UserPicker';

export interface GroupCreateFlowProps {
  /** Create the group inside this community (admins). */
  communityId?: ID;
  communityName?: string;
  /** Back from the first step. */
  onCancel: () => void;
  onCreated: (chat: ChatSummary) => void;
  backIcon?: 'arrow' | 'close';
}

export function GroupCreateFlow({
  communityId,
  communityName,
  onCancel,
  onCreated,
  backIcon = 'arrow',
}: GroupCreateFlowProps) {
  const me = useMe();
  const [step, setStep] = useState<'members' | 'details'>('members');
  const [selected, setSelected] = useState<UserPublic[]>([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState<{ id: ID; url: string } | null>(null);
  const [timer, setTimer] = useState<number | null>(
    me?.settings.defaultDisappearingSeconds ?? null,
  );
  const [settings, setSettings] = useState<GroupSettings>({ ...DEFAULT_GROUP_SETTINGS });
  const [timerOpen, setTimerOpen] = useState(false);
  const [permsOpen, setPermsOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AddMembersResult | null>(null);

  const toggle = (u: UserPublic) =>
    setSelected((list) =>
      list.some((x) => x.id === u.id) ? list.filter((x) => x.id !== u.id) : [...list, u],
    );

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
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
        ? await api.post<AddMembersResult>(`/api/communities/${communityId}/groups`, body)
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

  const finish = (chat: ChatSummary) => {
    toast.success(`Group “${chat.name ?? name}” created`);
    onCreated(chat);
  };

  if (step === 'members') {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col bg-surface">
        <PaneHeader
          title={communityId ? 'New group in community' : 'New group'}
          subtitle={
            selected.length
              ? `${selected.length} of ${MAX_GROUP_MEMBERS - 1} selected`
              : 'Add members'
          }
          back={onCancel}
          backIcon={backIcon}
          border
        />
        <UserPicker
          selected={selected}
          onToggle={toggle}
          query={query}
          onQueryChange={setQuery}
          autoFocus
        />
        <div className="pointer-events-none absolute right-5 bottom-[max(20px,env(safe-area-inset-bottom))]">
          <IconButton
            icon={ArrowRight}
            label={selected.length ? 'Next' : 'Skip adding members'}
            variant="brand"
            size="xl"
            shape="square"
            className="pointer-events-auto animate-pop shadow-elevated"
            onClick={() => setStep('details')}
          />
        </div>
      </div>
    );
  }

  const count = `${Array.from(name).length}/${MAX_GROUP_NAME_LENGTH}`;
  const adminOnly = Object.values(settings).filter(Boolean).length;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-surface">
      <PaneHeader
        title={communityId ? 'New group in community' : 'New group'}
        subtitle={communityName}
        back={() => setStep('members')}
        border
      />
      <form
        onSubmit={(e) => void submit(e)}
        className="min-h-0 flex-1 overflow-y-auto bg-app pb-28 scrollbar-thin"
        aria-label="Group details"
      >
        <div className="flex items-center gap-4 bg-surface px-5 pt-6 pb-5">
          <EditableAvatar
            src={avatar?.url}
            name={name || 'Group'}
            kind="group"
            size={72}
            label={avatar ? 'Change group icon' : 'Add group icon'}
            onUploaded={(m) => setAvatar({ id: m.id, url: m.url })}
            onRemove={() => setAvatar(null)}
          />
          <div className="min-w-0 flex-1">
            <Input
              label="Group name"
              aside={count}
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, MAX_GROUP_NAME_LENGTH))}
              placeholder="e.g. Weekend hiking"
              error={errors.name}
              autoFocus
              required
            />
          </div>
        </div>
        <div className="bg-surface px-5 pb-5">
          <Textarea
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
            autoResize
            maxRows={5}
            rows={2}
            placeholder="What's this group about?"
            error={errors.description}
          />
        </div>
        <div className="mt-2 bg-surface py-1">
          <SettingRow
            icon={Clock3}
            label="Disappearing messages"
            value={disappearingLabel(timer)}
            onClick={() => setTimerOpen(true)}
          />
          <SettingRow
            icon={ShieldCheck}
            label="Group permissions"
            value={adminOnly ? `${adminOnly} admin-only` : 'All members'}
            onClick={() => setPermsOpen(true)}
          />
        </div>
        <section className="mt-2 bg-surface px-5 py-4" aria-label="Members">
          <h3 className="text-[14px] font-medium text-muted">Members: {selected.length + 1}</h3>
          <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-x-1 gap-y-3">
            <li className="flex flex-col items-center gap-1">
              <UserAvatar user={me ? { ...me, contactName: null } : null} size="lg" />
              <span className="w-full truncate text-center text-[12px] text-muted">You</span>
            </li>
            {selected.map((u) => (
              <li key={u.id} className="flex flex-col items-center gap-1">
                <UserAvatar user={u} size="lg" />
                <span className="w-full truncate text-center text-[12px] text-muted">
                  {userDisplayName(u).split(' ')[0]}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
      <div className="pointer-events-none absolute right-5 bottom-[max(20px,env(safe-area-inset-bottom))]">
        <IconButton
          icon={Check}
          label="Create group"
          variant="brand"
          size="xl"
          shape="square"
          loading={busy}
          className="pointer-events-auto animate-pop shadow-elevated"
          onClick={() => void submit()}
        />
      </div>

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
        size="md"
        footer={<Button onClick={() => setPermsOpen(false)}>Done</Button>}
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
    </div>
  );
}

function SettingRow({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-5 px-5 py-3.5 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
    >
      <Icon size={22} className="text-muted" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15.5px] text-fg">{label}</span>
        <span className="text-[13px] text-muted">{value}</span>
      </span>
      <ChevronRight size={18} className="text-subtle" aria-hidden />
    </button>
  );
}
