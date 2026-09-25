/**
 * Community admins: create a new group inside the community, or link existing groups they
 * admin (regular groups not linked elsewhere).
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Link2, Plus, UsersRound } from 'lucide-react';
import { chatTitle, type ChatSummary, type Community } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, EmptyState, toast } from '@/components/ui';
import { GroupCreateFlow } from '@/features/groups/GroupCreateFlow';
import { RoundCheck } from '@/features/groups/shared/UserPicker';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useChats } from '@/stores/chats';
import { useCommunities } from '@/stores/communities';

/** Groups the viewer may link to a community (server: admin of the group, not linked). */
export function linkableGroups(byId: Record<string, ChatSummary>): ChatSummary[] {
  return Object.values(byId)
    .filter(
      (g) =>
        g.type === 'group' &&
        !g.isAnnouncement &&
        !g.communityId &&
        g.membership === 'active' &&
        (g.myRole === 'owner' || g.myRole === 'admin'),
    )
    .sort((a, b) => chatTitle(a).localeCompare(chatTitle(b)));
}

export function AddGroupsView({
  community: c,
  onClose,
}: {
  community: Community;
  onClose: () => void;
}) {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const [view, setView] = useState<'menu' | 'create' | 'existing'>('menu');

  if (view === 'create')
    return (
      <div className="flex h-full min-h-full flex-col">
        <GroupCreateFlow
          communityId={c.id}
          communityName={c.name}
          onCancel={() => setView('menu')}
          onCreated={(chat) => {
            void useCommunities
              .getState()
              .refreshCommunity(c.id)
              .catch(() => undefined);
            onClose();
            void navigate(`/chats/${chat.id}`);
          }}
        />
      </div>
    );
  if (view === 'existing')
    return <LinkExisting community={c} onBack={() => setView('menu')} onDone={onClose} />;

  return (
    <div className="flex min-h-full flex-col bg-surface">
      <PaneHeader
        title="Add groups"
        subtitle={c.name}
        back={onClose}
        backIcon={desktop ? 'close' : 'arrow'}
        border
      />
      <div className="py-2">
        <MenuRow
          icon={Plus}
          title="Create new group"
          description="Start a group that community members can find and join"
          onClick={() => setView('create')}
        />
        <MenuRow
          icon={Link2}
          title="Add existing groups"
          description="Bring in groups you're an admin of"
          onClick={() => setView('existing')}
        />
      </div>
    </div>
  );
}

function MenuRow({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: typeof Plus;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 px-5 py-3 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand">
        <Icon size={22} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[16px] font-medium text-fg">{title}</span>
        <span className="block text-[13px] text-muted">{description}</span>
      </span>
    </button>
  );
}

function LinkExisting({
  community: c,
  onBack,
  onDone,
}: {
  community: Community;
  onBack: () => void;
  onDone: () => void;
}) {
  const byId = useChats((s) => s.byId);
  const groups = useMemo(() => linkableGroups(byId), [byId]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const link = async () => {
    setBusy(true);
    try {
      await useCommunities.getState().linkGroups(c.id, [...picked]);
      toast.success(
        picked.size === 1 ? 'Group added to the community' : `${picked.size} groups added`,
      );
      onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full min-h-full flex-col bg-surface">
      <PaneHeader
        title="Add existing groups"
        subtitle={picked.size ? `${picked.size} selected` : c.name}
        back={onBack}
        border
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-24">
        {groups.length ? (
          <>
            <p className="px-5 pt-3 pb-1 text-[13px] text-muted">
              Groups you admin that aren't in a community. Their members become community members.
            </p>
            <ul>
              {groups.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={picked.has(g.id)}
                    aria-label={chatTitle(g)}
                    onClick={() => toggle(g.id)}
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
          </>
        ) : (
          <EmptyState
            compact
            icon={UsersRound}
            title="No groups to add"
            description="You can add groups where you're an admin and that don't belong to another community."
          />
        )}
      </div>
      {picked.size ? (
        <div className="absolute inset-x-0 bottom-0 border-t border-line bg-surface px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <Button fullWidth size="lg" loading={busy} onClick={() => void link()}>
            Add {picked.size === 1 ? 'group' : `${picked.size} groups`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
