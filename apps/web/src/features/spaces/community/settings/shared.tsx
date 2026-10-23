/**
 * Pieces of the community settings pages: the editor state (a fresh read of the settings, a
 * draft, the one PATCH of what changed), the unsaved-changes bar, an emoji button and the
 * role picker of onboarding options.
 */
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Plus, SmilePlus, X } from 'lucide-react';
import {
  PERM,
  hasPerm,
  highestRolePosition,
  type ID,
  type Space,
  type SpaceCommunity,
  type SpaceRole,
  type UpdateSpaceCommunityRequest,
} from '@enbox/shared';
import { Button, DropdownMenu, IconButton, Popover, Spinner, toast } from '@/components/ui';
import { LazyEmojiPicker } from '@/features/conversation/lazy';
import { errorMessage } from '@/lib/api';
import { useMe } from '@/stores/auth';
import { getCommunity, updateCommunity } from '../api';

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[12px] font-bold tracking-wide text-muted uppercase">{title}</h3>
      {description ? <div className="-mt-1 text-[13px] text-muted">{description}</div> : null}
      {children}
    </section>
  );
}

export interface CommunityEditor<D> {
  community: SpaceCommunity | null;
  loadError: string | null;
  draft: D | null;
  setDraft: (update: (d: D) => D) => void;
  /** What a save sends (empty when nothing changed). */
  body: UpdateSpaceCommunityRequest;
  dirty: boolean;
  busy: boolean;
  save: () => Promise<void>;
  reset: () => void;
}

/**
 * A settings page's state: the settings read fresh on open, a draft made by `toDraft`, and
 * `toBody` (what changed) sent as one PATCH on save. Pass module-level functions.
 */
export function useCommunityEditor<D>(
  spaceId: ID,
  toDraft: (c: SpaceCommunity) => D,
  toBody: (c: SpaceCommunity, d: D) => UpdateSpaceCommunityRequest,
): CommunityEditor<D> {
  const [community, setCommunity] = useState<SpaceCommunity | null>(null);
  const [draft, setDraftState] = useState<D | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    getCommunity(spaceId, { force: true })
      .then((c) => {
        if (!live) return;
        setCommunity(c);
        setDraftState(toDraft(c));
      })
      .catch((e: unknown) => live && setLoadError(errorMessage(e, 'Could not load the settings')));
    return () => {
      live = false;
    };
  }, [spaceId, toDraft]);

  const body = useMemo(() => (community && draft ? toBody(community, draft) : {}), [community, draft, toBody]);
  const dirty = Object.keys(body).length > 0;
  return {
    community,
    loadError,
    draft,
    setDraft: (update) => setDraftState((d) => (d === null ? d : update(d))),
    body,
    dirty,
    busy,
    async save() {
      if (!dirty || busy) return;
      setBusy(true);
      try {
        const fresh = await updateCommunity(spaceId, body);
        setCommunity(fresh);
        setDraftState(toDraft(fresh));
        toast.success('Changes saved');
      } catch (e) {
        toast.error(e);
      } finally {
        setBusy(false);
      }
    },
    reset() {
      if (community) setDraftState(toDraft(community));
    },
  };
}

/** Loading / error placeholder of a page whose settings are not here yet. */
export function EditorLoading({ error }: { error: string | null }) {
  if (error) return <p className="text-danger">{error}</p>;
  return (
    <div className="flex justify-center py-10 text-brand-ink">
      <Spinner />
    </div>
  );
}

/** Discord's "Careful — you have unsaved changes!" bar (Reset / Save Changes). */
export function UnsavedBar({
  editor,
  problem,
}: {
  editor: Pick<CommunityEditor<unknown>, 'dirty' | 'busy' | 'save' | 'reset'>;
  /** Why it cannot be saved yet (Save stays disabled). */
  problem?: string | null;
}) {
  if (!editor.dirty) return null;
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl bg-elevated p-3 pl-4 shadow-elevated"
    >
      <span className="min-w-0 flex-1 text-[14px] font-medium">
        {problem ? <span className="text-danger">{problem}</span> : 'Careful — you have unsaved changes!'}
      </span>
      <Button variant="ghost" size="sm" onClick={editor.reset} disabled={editor.busy}>
        Reset
      </Button>
      <Button size="sm" loading={editor.busy} disabled={!!problem} onClick={() => void editor.save()}>
        Save Changes
      </Button>
    </div>
  );
}

/** An emoji slot: shows the emoji (or a smiley), opens the picker; the × clears it. */
export function EmojiButton({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (emoji: string | null) => void;
  label: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={value ? `${label}: ${value}` : label}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className="flex size-11 items-center justify-center rounded-xl bg-surface-2 text-[22px] text-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
      >
        {value || <SmilePlus size={20} aria-hidden />}
      </button>
      {value ? (
        <button
          type="button"
          aria-label={`Remove ${label.toLowerCase()}`}
          onClick={() => onChange(null)}
          className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-elevated text-muted shadow-sm hover:text-fg"
        >
          <X size={12} aria-hidden />
        </button>
      ) : null}
      <Popover open={!!anchor} anchor={anchor} onClose={() => setAnchor(null)} placement="bottom" align="start" aria-label="Pick an emoji">
        <div className="h-[340px] w-[320px] max-w-[calc(100vw_-_16px)] overflow-hidden rounded-2xl bg-elevated shadow-elevated">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-brand-ink">
                <Spinner />
              </div>
            }
          >
            <LazyEmojiPicker
              height="100%"
              width="100%"
              autoFocusSearch
              onPick={(e) => {
                onChange(e);
                setAnchor(null);
              }}
            />
          </Suspense>
        </div>
      </Popover>
    </span>
  );
}

/** Position of my highest role in the Space (owner: Infinity). */
export function myTopPosition(space: Space, meId: ID | undefined): number {
  return highestRolePosition(space.roles, space.me.roleIds, space.ownerId === meId);
}

/** Roles I may hand out in onboarding: not @everyone, below my highest role (needs Manage Roles). */
export function useAssignableRoles(space: Space): { roles: SpaceRole[]; allowed: boolean } {
  const me = useMe();
  return useMemo(() => {
    const top = myTopPosition(space, me?.id);
    return {
      allowed: hasPerm(space.myPermissions, PERM.MANAGE_ROLES),
      roles: space.roles.filter((r) => !r.isDefault && r.position < top).sort((a, b) => b.position - a.position),
    };
  }, [space, me?.id]);
}

/** The roles of an onboarding option (chips) and an "Add role" menu of the roles I may hand out. */
export function RolePicker({
  space,
  value,
  onChange,
  max = 10,
}: {
  space: Space;
  value: ID[];
  onChange: (roleIds: ID[]) => void;
  max?: number;
}) {
  const { roles, allowed } = useAssignableRoles(space);
  const byId = new Map(space.roles.map((r) => [r.id, r]));
  const left = roles.filter((r) => !value.includes(r.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((id) => {
        const r = byId.get(id);
        return (
          <span key={id} className="flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[12px]">
            <span className="size-2 rounded-full" style={{ background: r?.color ?? 'var(--muted)' }} aria-hidden />
            {r?.name ?? 'Deleted role'}
            <button
              type="button"
              aria-label={`Remove ${r?.name ?? 'role'}`}
              onClick={() => onChange(value.filter((x) => x !== id))}
              className="ml-0.5 rounded-full text-muted hover:text-fg"
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        );
      })}
      {allowed && value.length < max ? (
        <DropdownMenu
          aria-label="Roles"
          align="start"
          items={
            left.length
              ? left.map((r) => ({ label: r.name, onSelect: () => onChange([...value, r.id]) }))
              : [{ label: 'No roles you can hand out', disabled: true }]
          }
          trigger={({ active: _active, ...p }) => (
            <button
              {...p}
              type="button"
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold text-brand-ink hover:bg-hover"
            >
              <Plus size={12} aria-hidden /> Add role
            </button>
          )}
        />
      ) : null}
      {!allowed && value.length === 0 ? (
        <span className="text-[12px] text-subtle">Handing out roles needs Manage Roles</span>
      ) : null}
    </div>
  );
}

/** Icon button rows use: move up / down / remove. */
export function RowActions({
  index,
  count,
  onMove,
  onRemove,
  what,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
  what: string;
}) {
  return (
    <span className="flex shrink-0 items-center">
      <IconButton
        icon={ChevronUp}
        label={`Move ${what} up`}
        size="xs"
        variant="ghost"
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      />
      <IconButton
        icon={ChevronDown}
        label={`Move ${what} down`}
        size="xs"
        variant="ghost"
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      />
      <IconButton icon={X} label={`Remove ${what}`} size="xs" variant="ghost" onClick={onRemove} />
    </span>
  );
}

/** `list` with the item at `from` moved to `to`. Pure. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** A short random id for prompts and options (unique within the Space's onboarding). */
export function shortId(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}
