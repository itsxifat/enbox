/**
 * Space Settings ▸ Members (moderators): Discord's members table. A virtualised list of the
 * member (avatar, name, @username), "Member since", "Joined Enbox", roles (+N) and signals
 * ("New account" under 7 days, "Timed out"); search, filters (roles, joined, account age,
 * timed out) and sorting through `GET members/search` with cursor paging and a count. Rows
 * open Mod View; checkboxes feed the bulk bar. Ban by ID, and the security actions (pause
 * invites / DMs) for moderators who may use them. `?joined=1h` presets the joined filter
 * (raid alerts link here).
 */
import { Suspense, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Virtuoso } from 'react-virtuoso';
import { Ban, ChevronDown, MoreHorizontal, ShieldAlert } from 'lucide-react';
import {
  PERM,
  hasPerm,
  userDisplayName,
  type ID,
  type MemberSort,
  type ModMember,
  type Space,
} from '@enbox/shared';
import {
  Avatar,
  Button,
  Checkbox,
  DropdownMenu,
  IconButton,
  Modal,
  SearchInput,
  Spinner,
  type MenuAnchor,
  type MenuTriggerProps,
} from '@/components/ui';
import { MemberActionsMenu } from '@/features/spaces/MemberActions';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { lazyNamed } from '@/lib/lazy';
import { useMe } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUser, useUsers } from '@/stores/users';
import { canSeeSecurity, liveUntil, searchMembers, toSpaceMember, type MemberSearch } from './api';
import { BulkBar, membersLabel } from './BulkBar';
import { BanByIdDialog } from './dialogs';
import {
  JOINED_FILTERS,
  NEW_ACCOUNT_MS,
  fullDate,
  isNewAccount,
  isTimedOut,
  timeAgo,
  untilLabel,
  type JoinedFilter,
} from './labels';
import { SecurityCard } from './SecurityCard';

const ModViewPanel = lazyNamed(() => import('./ModView'), 'ModViewPanel');

const PAGE = 100;
/** The server stops counting matches here (`ModMemberPage.total`). */
const TOTAL_CAP = 10_000;
/** Any of these gives the bulk bar something to do. */
const BULK_PERMS = [PERM.KICK_MEMBERS, PERM.BAN_MEMBERS, PERM.MODERATE_MEMBERS, PERM.MANAGE_ROLES];
/** Chips shown per row before "+N". */
const ROLE_CHIPS = 2;

const SORTS: { id: MemberSort; label: string }[] = [
  { id: 'joined_desc', label: 'Newest joined' },
  { id: 'joined_asc', label: 'Oldest joined' },
  { id: 'name', label: 'Name' },
];

/** The table's columns (narrow screens drop the dates and roles). */
const COLS =
  'grid items-center gap-3 grid-cols-[24px_minmax(0,1fr)_auto_32px] sm:grid-cols-[24px_minmax(0,1.6fr)_minmax(0,1fr)_auto_32px] md:grid-cols-[24px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto_32px] lg:grid-cols-[24px_minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_auto_32px]';

interface Filters {
  q: string;
  roleIds: ID[];
  joined: JoinedFilter;
  newAccounts: boolean;
  timedOut: boolean;
  sort: MemberSort;
}

/** The search for a page (relative filters are measured from now). */
export function memberSearchOf(f: Filters, after: string | null, now = Date.now()): MemberSearch {
  const joinedMs = JOINED_FILTERS.find((x) => x.id === f.joined)?.ms ?? 0;
  return {
    q: f.q || undefined,
    roleIds: f.roleIds,
    joinedAfter: joinedMs ? new Date(now - joinedMs).toISOString() : undefined,
    accountCreatedAfter: f.newAccounts ? new Date(now - NEW_ACCOUNT_MS).toISOString() : undefined,
    timedOut: f.timedOut || undefined,
    sort: f.sort,
    after,
    limit: PAGE,
  };
}

function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap',
        className,
      )}
    >
      {children}
    </span>
  );
}

function FilterToggle({
  on,
  onChange,
  children,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cn(
        'h-8 rounded-full px-3 text-[13px] font-medium transition-colors',
        on ? 'bg-brand-soft text-brand-ink' : 'bg-surface text-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function FilterMenuButton({
  active,
  children,
  ...p
}: Omit<MenuTriggerProps, 'active'> & { active: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      {...p}
      className={cn(
        'flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium transition-colors',
        active ? 'bg-brand-soft text-brand-ink' : 'bg-surface text-muted hover:text-fg',
      )}
    >
      {children}
      <ChevronDown size={14} aria-hidden />
    </button>
  );
}

function MemberRow({
  space,
  member,
  selected,
  onSelect,
  onOpen,
  onMenu,
}: {
  space: Space;
  member: ModMember;
  selected: boolean;
  /** Null when I have no bulk action (no checkbox). */
  onSelect: ((on: boolean) => void) | null;
  onOpen: () => void;
  onMenu: (anchor: MenuAnchor) => void;
}) {
  const user = useUser(member.userId) ?? member.user;
  const name = member.nickname || userDisplayName(user);
  const roles = space.roles
    .filter((r) => !r.isDefault && member.roleIds.includes(r.id))
    .sort((a, b) => b.position - a.position);
  const more = roles.slice(ROLE_CHIPS);
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <div
      role="row"
      aria-selected={selected}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
      className={cn(
        COLS,
        'h-14 cursor-pointer rounded-lg px-3 hover:bg-hover',
        selected && 'bg-selected hover:bg-selected',
      )}
      data-testid="mod-member-row"
    >
      <span role="cell" onClick={stop}>
        {onSelect ? (
          <Checkbox checked={selected} onChange={onSelect} aria-label={`Select ${name}`} />
        ) : null}
      </span>
      <span role="cell" className="min-w-0">
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-3 text-left"
          title="Open Mod View"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          <Avatar
            src={member.avatarUrl ?? user.avatarUrl}
            name={name}
            colorSeed={member.userId}
            size={32}
            decorative
          />
          <span className="min-w-0">
            <span className="block truncate text-[14.5px] font-medium text-fg">{name}</span>
            <span className="block truncate text-[12.5px] text-muted">@{user.username}</span>
          </span>
        </button>
      </span>
      <span
        role="cell"
        className="hidden truncate text-[13px] text-muted sm:block"
        title={fullDate(member.joinedAt)}
      >
        {timeAgo(member.joinedAt)}
      </span>
      <span
        role="cell"
        className="hidden truncate text-[13px] text-muted md:block"
        title={fullDate(member.accountCreatedAt)}
      >
        {timeAgo(member.accountCreatedAt)}
      </span>
      <span role="cell" className="hidden min-w-0 items-center gap-1 overflow-hidden lg:flex">
        {roles.slice(0, ROLE_CHIPS).map((r) => (
          <Chip key={r.id} className="flex items-center gap-1 bg-surface">
            <span
              className="size-2 rounded-full"
              style={{ background: r.color ?? 'var(--color-muted)' }}
              aria-hidden
            />
            <span className="max-w-24 truncate">{r.name}</span>
          </Chip>
        ))}
        {more.length ? (
          <Chip className="bg-surface text-muted">
            <span title={more.map((r) => r.name).join(', ')}>+{more.length}</span>
          </Chip>
        ) : null}
      </span>
      <span role="cell" className="flex flex-wrap items-center justify-end gap-1">
        {isNewAccount(member.accountCreatedAt) ? (
          <Chip className="bg-warning-soft text-warning-ink">New account</Chip>
        ) : null}
        {isTimedOut(member.timedOutUntil) ? (
          <Chip className="bg-danger-soft text-danger">Timed out</Chip>
        ) : null}
      </span>
      <span role="cell" onClick={stop}>
        <IconButton
          icon={MoreHorizontal}
          label={`${name} actions`}
          variant="ghost"
          size="sm"
          onClick={(e) => onMenu(e.currentTarget)}
        />
      </span>
    </div>
  );
}

export function MembersPage({ space }: { space: Space }) {
  const me = useMe();
  const [params] = useSearchParams();
  const linked = JOINED_FILTERS.find((f) => f.id === params.get('joined'))?.id;
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 250);
  const [roleIds, setRoleIds] = useState<ID[]>([]);
  const [joined, setJoined] = useState<JoinedFilter>(linked ?? 'any');
  const [newAccounts, setNewAccounts] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [sort, setSort] = useState<MemberSort>('joined_desc');
  const [reload, setReload] = useState(0);
  const [rows, setRows] = useState<ModMember[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<ID>>(new Set());
  const [modView, setModView] = useState<ID | null>(null);
  const [menu, setMenu] = useState<{ userId: ID; anchor: MenuAnchor } | null>(null);
  const [dialog, setDialog] = useState<'banById' | 'security' | null>(null);
  const req = useRef(0);
  const cache = useSpaces((s) => s.members[space.id]);
  const canBulk = BULK_PERMS.some((p) => hasPerm(space.myPermissions, p));
  const filters: Filters = { q, roleIds, joined, newAccounts, timedOut, sort };
  const filtered = !!(q || roleIds.length || joined !== 'any' || newAccounts || timedOut);

  // A raid alert's link while the page is open.
  useEffect(() => {
    if (linked) setJoined(linked);
  }, [linked]);

  const fetchPage = async (after: string | null) => {
    const id = ++req.current;
    setLoading(true);
    setError(null);
    try {
      const page = await searchMembers(space.id, memberSearchOf(filters, after));
      if (id !== req.current) return;
      useUsers.getState().upsertUsers(page.members.map((m) => m.user));
      useSpaces.getState().upsertMembers(space.id, page.members.map(toSpaceMember));
      setRows((cur) => (after ? [...cur, ...page.members] : page.members));
      setNext(page.nextCursor);
      setTotal(page.total);
    } catch (e) {
      if (id === req.current) setError(errorMessage(e));
    } finally {
      if (id === req.current) setLoading(false);
    }
  };

  useEffect(() => {
    setSelected(new Set());
    void fetchPage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space.id, q, roleIds.join(), joined, newAccounts, timedOut, sort, reload]);

  // Live rows: changes from the member cache; members kicked or banned meanwhile drop out.
  const shown = rows
    .filter((m) => !cache || cache[m.userId])
    .map((m) => (cache?.[m.userId] ? { ...m, ...cache[m.userId]! } : m));
  const allSelected = shown.length > 0 && shown.every((m) => selected.has(m.userId));
  const toggle = (id: ID, on: boolean) =>
    setSelected((cur) => {
      const s = new Set(cur);
      if (on) s.add(id);
      else s.delete(id);
      return s;
    });
  const menuMember = menu ? shown.find((m) => m.userId === menu.userId) : undefined;
  const security = space.security;
  const invitesPaused = liveUntil(security?.invitesPausedUntil);
  const dmsPaused = liveUntil(security?.dmsPausedUntil);
  const roleChoices = space.roles
    .filter((r) => !r.isDefault)
    .sort((a, b) => b.position - a.position);
  const joinedLabel = JOINED_FILTERS.find((f) => f.id === joined)!.label;
  const sortLabel = SORTS.find((s) => s.id === sort)!.label;
  const countLabel =
    total >= TOTAL_CAP ? `${TOTAL_CAP.toLocaleString()}+ members` : membersLabel(total);

  return (
    <div className="flex flex-col gap-4">
      {invitesPaused || dmsPaused ? (
        <div
          className="flex items-center gap-3 rounded-xl bg-danger-soft px-4 py-3 text-danger"
          role="status"
        >
          <ShieldAlert size={18} aria-hidden />
          <p className="min-w-0 flex-1 text-[14px] font-medium">
            {[
              invitesPaused ? `Invites are paused ${untilLabel(invitesPaused)}` : null,
              dmsPaused ? `DMs are paused ${untilLabel(dmsPaused)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setDialog('security')}>
            Manage
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search by name, username or ID"
            aria-label="Search members"
          />
        </div>
        {canSeeSecurity(space) ? (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={ShieldAlert}
            onClick={() => setDialog('security')}
          >
            Security actions
          </Button>
        ) : null}
        {hasPerm(space.myPermissions, PERM.BAN_MEMBERS) ? (
          <Button size="sm" variant="secondary" leftIcon={Ban} onClick={() => setDialog('banById')}>
            Ban by ID
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        {roleChoices.length ? (
          <DropdownMenu
            aria-label="Filter by role"
            trigger={({ active: _active, ...p }) => (
              <FilterMenuButton {...p} active={roleIds.length > 0}>
                {roleIds.length ? `Roles (${roleIds.length})` : 'Roles'}
              </FilterMenuButton>
            )}
            items={roleChoices.map((r) => ({
              label: r.name,
              checked: roleIds.includes(r.id),
              keepOpen: true,
              onSelect: () =>
                setRoleIds((cur) =>
                  cur.includes(r.id) ? cur.filter((x) => x !== r.id) : [...cur, r.id],
                ),
            }))}
          />
        ) : null}
        <DropdownMenu
          aria-label="Filter by join date"
          trigger={({ active: _active, ...p }) => (
            <FilterMenuButton {...p} active={joined !== 'any'}>
              {joined === 'any' ? 'Joined' : `Joined: ${joinedLabel}`}
            </FilterMenuButton>
          )}
          items={JOINED_FILTERS.map((f) => ({
            label: f.label,
            checked: joined === f.id,
            radio: true,
            onSelect: () => setJoined(f.id),
          }))}
        />
        <FilterToggle on={newAccounts} onChange={setNewAccounts}>
          New accounts
        </FilterToggle>
        <FilterToggle on={timedOut} onChange={setTimedOut}>
          Timed out
        </FilterToggle>
        <DropdownMenu
          aria-label="Sort members"
          trigger={({ active: _active, ...p }) => (
            <FilterMenuButton {...p} active={false}>
              Sort: {sortLabel}
            </FilterMenuButton>
          )}
          items={SORTS.map((s) => ({
            label: s.label,
            checked: sort === s.id,
            radio: true,
            onSelect: () => setSort(s.id),
          }))}
        />
        {filtered ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQuery('');
              setRoleIds([]);
              setJoined('any');
              setNewAccounts(false);
              setTimedOut(false);
            }}
          >
            Clear filters
          </Button>
        ) : null}
        <span className="ml-auto text-[13px] text-muted" aria-live="polite">
          {loading && !rows.length ? 'Loading…' : countLabel}
        </span>
      </div>

      {selected.size ? (
        <BulkBar
          space={space}
          selected={[...selected]}
          onClear={() => setSelected(new Set())}
          onDone={() => setReload((n) => n + 1)}
        />
      ) : null}

      <div
        className="card-inset flex flex-col p-1"
        role="table"
        aria-label="Members"
        aria-rowcount={total}
      >
        <div role="row" className={cn(COLS, 'section-label px-3 pt-2 pb-1')}>
          <span role="columnheader">
            {canBulk ? (
              <Checkbox
                checked={allSelected}
                indeterminate={selected.size > 0 && !allSelected}
                onChange={(on) => setSelected(on ? new Set(shown.map((m) => m.userId)) : new Set())}
                aria-label="Select all members"
              />
            ) : null}
          </span>
          <span role="columnheader">Member</span>
          <span role="columnheader" className="hidden sm:block">
            Member since
          </span>
          <span role="columnheader" className="hidden md:block">
            Joined Enbox
          </span>
          <span role="columnheader" className="hidden lg:block">
            Roles
          </span>
          <span role="columnheader" className="text-right">
            Signals
          </span>
          <span role="columnheader">
            <span className="sr-only">Actions</span>
          </span>
        </div>
        {error ? (
          <div className="flex items-center gap-3 p-4">
            <p className="text-danger">{error}</p>
            <Button size="sm" variant="soft" onClick={() => setReload((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : null}
        {!error && !loading && shown.length === 0 ? (
          <p className="p-4 text-muted">{filtered ? 'No members match.' : 'No members yet.'}</p>
        ) : null}
        {shown.length ? (
          <Virtuoso
            // Rows are h-14 (56px): short lists don't leave a tall empty table.
            style={{ height: `min(64vh, 640px, ${shown.length * 56}px)` }}
            data={shown}
            computeItemKey={(_, m) => m.userId}
            endReached={() => {
              if (next && !loading) void fetchPage(next);
            }}
            itemContent={(_, m) => (
              <MemberRow
                space={space}
                member={m}
                selected={selected.has(m.userId)}
                onSelect={canBulk ? (on) => toggle(m.userId, on) : null}
                onOpen={() => setModView(m.userId)}
                onMenu={(anchor) => setMenu({ userId: m.userId, anchor })}
              />
            )}
          />
        ) : null}
        {loading && rows.length ? (
          <div className="flex justify-center p-2">
            <Spinner size={18} />
          </div>
        ) : null}
        {loading && !rows.length && !error ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : null}
      </div>

      {menu && menuMember && me ? (
        <MemberActionsMenu
          space={space}
          member={menuMember}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {modView ? (
        <Suspense fallback={null}>
          <ModViewPanel space={space} userId={modView} onClose={() => setModView(null)} />
        </Suspense>
      ) : null}
      {dialog === 'banById' ? (
        <BanByIdDialog
          space={space}
          onClose={() => setDialog(null)}
          onBanned={() => setReload((n) => n + 1)}
        />
      ) : null}
      {dialog === 'security' ? (
        <Modal open onClose={() => setDialog(null)} title="Security actions" size="lg">
          <SecurityCard space={space} compact />
        </Modal>
      ) : null}
    </div>
  );
}
