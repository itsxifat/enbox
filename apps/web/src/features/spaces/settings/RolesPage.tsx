/**
 * Space Settings → Roles (Discord's Roles page): the role list, highest first, reordered by
 * dragging (pointer, or keyboard on the grip: Space to lift, arrows, Space to drop) or with
 * Alt+↑/↓ on a role; only roles below my highest role move, and only to places below it
 * (the owner moves anything). The editor: Display (name, colour, Role Style with a live name
 * preview, the gradient's second colour, a contrast warning, Role Icon), the list switches and
 * the permissions. Saves go to the REST routes; the `space:updated { roles }` echo is the truth.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, GripVertical, ImagePlus, Lock, Plus, Trash2, X } from 'lucide-react';
import {
  PERM,
  canManageRole,
  grantableBits,
  hasPerm,
  highestRolePosition,
  isSpaceAdmin,
  type RoleColorStyle,
  type Space,
  type SpaceRole,
  type UpdateRoleRequest,
} from '@enbox/shared';
import { StyledName } from '@/components/cosmetics';
import { Avatar, Button, Field, Input, Switch, confirm, toast } from '@/components/ui';
import { isAcceptedImage, loadImage } from '@/features/settings/profile/avatar';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { roleNameStyle, useSpaces } from '@/stores/spaces';
import { RoleIcon } from '../RoleIcon';
import { createRole, deleteRole, reorderRoles, updateRole } from '../actions';
import { PERMISSION_GROUPS } from '../permissionLabels';

const COLORS = ['#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b', '#5865f2', '#eb459e'];

const STYLES: { id: RoleColorStyle; label: string; hint: string }[] = [
  { id: 'solid', label: 'Solid', hint: 'One colour' },
  { id: 'gradient', label: 'Gradient', hint: 'Two colours, blended' },
  { id: 'holographic', label: 'Holographic', hint: 'A shimmering rainbow' },
];

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * The new order (role ids, highest first) after moving `from` → `to` in `ordered` (the roles
 * except @everyone, highest first); null when nothing moves, 'forbidden' when a role at or
 * above my highest role would move or a role would land there (what the server refuses).
 */
export function planRoleMove(
  ordered: readonly Pick<SpaceRole, 'id' | 'position'>[],
  from: number,
  to: number,
  myTop: number,
): string[] | 'forbidden' | null {
  if (from === to || from < 0 || to < 0 || from >= ordered.length || to >= ordered.length) return null;
  const next = arrayMove([...ordered], from, to);
  const n = next.length;
  for (let i = 0; i < n; i++) {
    const r = next[i]!;
    const pos = n - i;
    if (pos !== r.position && (r.position >= myTop || pos >= myTop)) return 'forbidden';
  }
  return next.map((r) => r.id);
}

/** WCAG relative luminance of `#rrggbb` (null when it is not one). */
function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** WCAG contrast ratio of two `#rrggbb` colours (1 … 21; null when one is not a hex colour). */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Below this a name is hard to read on the background (WCAG's large-text minimum). */
export const MIN_NAME_CONTRAST = 3;

/** The surface names sit on, for the current theme (the token, else the theme's default). */
function themeSurface(): { color: string; theme: 'dark' | 'light' } {
  const root = typeof document === 'undefined' ? null : document.documentElement;
  const theme = root?.classList.contains('dark') ? 'dark' : 'light';
  let token = '';
  try {
    if (root) token = getComputedStyle(root).getPropertyValue('--surface').trim();
  } catch {
    // No computed styles (tests, very old engines): the theme default below.
  }
  const color = luminance(token) === null ? (theme === 'dark' ? '#1a1a1e' : '#ffffff') : token;
  return { color, theme };
}

/** A role icon upload: the image drawn into 128×128 (contain, transparency kept) as a PNG. */
async function renderRoleIcon(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process the image');
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function RolesPage({ space }: { space: Space }) {
  const me = useMe();
  const roles = useMemo(() => [...space.roles].sort((a, b) => b.position - a.position), [space.roles]);
  const [selectedId, setSelectedId] = useState<string>(roles[0]?.id ?? '');
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0];
  const owner = space.ownerId === me?.id;
  const myTop = highestRolePosition(space.roles, space.me.roleIds, owner);
  const canManage = hasPerm(space.myPermissions, PERM.MANAGE_ROLES);
  const [busy, setBusy] = useState(false);
  const ordered = useMemo(() => roles.filter((r) => !r.isDefault), [roles]);
  const everyone = roles.find((r) => r.isDefault);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const add = async () => {
    setBusy(true);
    try {
      const r = await createRole(space.id, { name: 'new role', color: COLORS[roles.length % COLORS.length] });
      setSelectedId(r.id);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  /** Apply a new order at once (positions highest first), save, put it back on failure. */
  const move = async (from: number, to: number) => {
    const plan = planRoleMove(ordered, from, to, myTop);
    if (plan === null) return;
    if (plan === 'forbidden') {
      toast.error('You can only move roles below your highest role.');
      return;
    }
    const before = space.roles;
    const n = plan.length;
    const pos = new Map(plan.map((id, i) => [id, n - i]));
    useSpaces.getState().applySpaceUpdate(space.id, {
      roles: before.map((r) => (r.isDefault ? r : { ...r, position: pos.get(r.id) ?? r.position })),
    });
    try {
      await reorderRoles(space.id, plan);
    } catch (e) {
      useSpaces.getState().applySpaceUpdate(space.id, { roles: before });
      toast.error(e);
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ordered.findIndex((r) => r.id === active.id);
    const to = ordered.findIndex((r) => r.id === over.id);
    void move(from, to);
  };

  const nameOf = (id: string | number) => ordered.find((r) => r.id === id)?.name ?? 'role';
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(active.id)} is over ${nameOf(over.id)}.` : `${nameOf(active.id)} is no longer over a role.`,
    onDragEnd: ({ active, over }) =>
      over ? `${nameOf(active.id)} was dropped at ${nameOf(over.id)}.` : `${nameOf(active.id)} was dropped.`,
    onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} was cancelled.`,
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex shrink-0 flex-col gap-1 lg:w-64">
        {canManage ? (
          <Button leftIcon={Plus} variant="soft" loading={busy} onClick={() => void add()} className="mb-2" data-testid="create-role">
            Create role
          </Button>
        ) : null}
        <p className="mb-1 px-1 text-[12px] text-muted">
          Members use the colour of their highest role. Drag to reorder{owner ? '' : ' (roles below yours)'}.
        </p>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable: 'To pick up a role, press Space or Enter. Use the arrow keys to move it, Space or Enter to drop it, Escape to cancel.',
            },
          }}
        >
          <SortableContext items={ordered.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-0.5" aria-label="Roles" data-testid="role-list">
              {ordered.map((r, i) => (
                <SortableRole
                  key={r.id}
                  role={r}
                  selected={selected?.id === r.id}
                  draggable={canManage && canManageRole(myTop, r.position)}
                  locked={!canManageRole(myTop, r.position)}
                  onSelect={() => setSelectedId(r.id)}
                  onMove={(dir) => void move(i, i + dir)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        {everyone ? (
          <button
            type="button"
            onClick={() => setSelectedId(everyone.id)}
            className={cn('mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[15px]', selected?.id === everyone.id ? 'bg-selected font-semibold' : 'hover:bg-hover')}
          >
            <span className="size-3 shrink-0 rounded-full bg-muted" aria-hidden />
            <span className="truncate">@everyone</span>
          </button>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        {selected ? <RoleEditor key={selected.id} space={space} role={selected} myTop={myTop} /> : null}
      </div>
    </div>
  );
}

function SortableRole({
  role,
  selected,
  draggable,
  locked,
  onSelect,
  onMove,
}: {
  role: SpaceRole;
  selected: boolean;
  draggable: boolean;
  locked: boolean;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: role.id,
    disabled: !draggable,
  });
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!draggable || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    onMove(e.key === 'ArrowUp' ? -1 : 1);
  };
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group/role flex items-center rounded-lg', isDragging && 'relative z-10 bg-elevated shadow-elevated')}
      data-testid={`role-row-${role.id}`}
    >
      {draggable ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Drag ${role.name}`}
          className="flex h-9 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-subtle opacity-0 group-hover/role:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-brand active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} aria-hidden />
        </button>
      ) : (
        <span className="w-5 shrink-0" aria-hidden />
      )}
      <button
        type="button"
        onClick={onSelect}
        onKeyDown={onKeyDown}
        aria-current={selected || undefined}
        aria-keyshortcuts={draggable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
        className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-[15px]', selected ? 'bg-selected font-semibold' : 'hover:bg-hover')}
      >
        <span className="size-3 shrink-0 rounded-full" style={{ background: swatchOf(role) }} aria-hidden />
        <StyledName name={role.name} role={roleNameStyle(role)} mode="full" className="truncate" />
        <RoleIcon role={role} size={16} />
        {locked ? <Lock size={13} className="ml-auto shrink-0 text-subtle" aria-label="Above your highest role" /> : null}
      </button>
    </li>
  );
}

/** The list dot: the colour, the gradient, or a rainbow for holographic. */
function swatchOf(r: Pick<SpaceRole, 'color' | 'colorSecondary' | 'colorStyle'>): string {
  if (r.colorStyle === 'holographic') return 'conic-gradient(#ff6ad5, #c774e8, #ad8cff, #8795e8, #94d0ff, #ff6ad5)';
  if (r.colorStyle === 'gradient' && r.color && r.colorSecondary)
    return `linear-gradient(135deg, ${r.color}, ${r.colorSecondary})`;
  return r.color ?? 'var(--color-muted)';
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

interface IconDraft {
  /** undefined = unchanged, null = removed, string = a new upload (not saved yet). */
  mediaId?: string | null;
  url: string | null;
}

function RoleEditor({ space, role, myTop }: { space: Space; role: SpaceRole; myTop: number }) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState<string | null>(role.color);
  const [style, setStyle] = useState<RoleColorStyle>(role.colorStyle ?? 'solid');
  const [secondary, setSecondary] = useState<string | null>(role.colorSecondary ?? null);
  const [emoji, setEmoji] = useState(role.iconEmoji ?? '');
  const [icon, setIcon] = useState<IconDraft>({ url: role.iconUrl ?? null });
  const [hoist, setHoist] = useState(role.hoist);
  const [mentionable, setMentionable] = useState(role.mentionable);
  const [perms, setPerms] = useState(role.permissions);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const me = useMe();
  useEffect(() => setPerms(role.permissions), [role.permissions]);
  const editable = role.isDefault ? hasPerm(space.myPermissions, PERM.MANAGE_ROLES) : canManageRole(myTop, role.position);
  const grantable = grantableBits(space.myPermissions);

  const emojiValue = emoji.trim() || null;
  const body: UpdateRoleRequest = {};
  if (!role.isDefault) {
    if ((name.trim() || role.name) !== role.name) body.name = name.trim();
    if (color !== role.color) body.color = color;
    if (style !== (role.colorStyle ?? 'solid')) body.colorStyle = style;
    if (secondary !== (role.colorSecondary ?? null)) body.colorSecondary = secondary;
    if (emojiValue !== (role.iconEmoji ?? null)) body.iconEmoji = emojiValue;
    if (icon.mediaId !== undefined) body.iconMediaId = icon.mediaId;
    if (hoist !== role.hoist) body.hoist = hoist;
  }
  if (mentionable !== role.mentionable) body.mentionable = mentionable;
  if (perms !== role.permissions) body.permissions = perms;
  const dirty = Object.keys(body).length > 0;
  const gradientIncomplete = style === 'gradient' && (!color || !secondary);

  const reset = () => {
    setName(role.name);
    setColor(role.color);
    setStyle(role.colorStyle ?? 'solid');
    setSecondary(role.colorSecondary ?? null);
    setEmoji(role.iconEmoji ?? '');
    setIcon({ url: role.iconUrl ?? null });
    setHoist(role.hoist);
    setMentionable(role.mentionable);
    setPerms(role.permissions);
  };

  const save = async () => {
    setBusy(true);
    try {
      const saved = await updateRole(space.id, role.id, body);
      // Saved: the new upload is the stored icon now.
      setIcon({ url: saved?.iconUrl ?? icon.url });
      toast.success('Role saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const onIconFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!isAcceptedImage(f)) {
      toast.error('Choose an image (PNG, JPEG, WebP or GIF).');
      return;
    }
    setUploading(true);
    try {
      const media = await api.upload(await renderRoleIcon(f), { kind: 'image', width: 128, height: 128 }, undefined, {
        fileName: 'role-icon.png',
      });
      setIcon({ mediaId: media.id, url: media.url });
    } catch (err) {
      toast.error(err);
    } finally {
      setUploading(false);
    }
  };

  const draftRole = {
    name: name.trim() || role.name,
    color,
    colorSecondary: secondary,
    colorStyle: style,
    iconUrl: icon.url,
    iconEmoji: emojiValue,
  };
  const surface = themeSurface();
  const lowContrast =
    style !== 'holographic' &&
    [color, style === 'gradient' ? secondary : null].some(
      (c) => c && (contrastRatio(c, surface.color) ?? 21) < MIN_NAME_CONTRAST,
    );

  return (
    <div className="flex flex-col gap-5">
      {!editable ? (
        <p className="card-inset p-3 text-[14px] text-muted">You can only edit roles below your highest role.</p>
      ) : null}
      {!role.isDefault ? (
        <section className="flex flex-col gap-4" aria-labelledby="role-display">
          <h3 id="role-display" className="text-[12px] font-bold tracking-wide text-muted uppercase">
            Display
          </h3>
          <Field label="Role name" htmlFor="role-name">
            <Input id="role-name" value={name} maxLength={100} disabled={!editable} onChange={(e) => setName(e.target.value)} />
          </Field>

          <div>
            <p className="mb-2 text-[14px] font-medium">Role Style</p>
            <div role="radiogroup" aria-label="Role Style" className="flex flex-wrap gap-2">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={style === s.id}
                  disabled={!editable}
                  onClick={() => setStyle(s.id)}
                  className={cn(
                    'card-inset flex min-w-28 flex-col items-start gap-0.5 px-3 py-2 text-left outline-none transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60',
                    style === s.id && 'ring-2 ring-brand',
                  )}
                >
                  <span className="flex items-center gap-2 text-[14px] font-semibold">
                    <span className="size-3 rounded-full" style={{ background: swatchOf({ color: color ?? COLORS[2]!, colorSecondary: secondary ?? COLORS[3]!, colorStyle: s.id }) }} aria-hidden />
                    {s.label}
                  </span>
                  <span className="text-[12px] text-muted">{s.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {style !== 'holographic' ? (
            <ColourRow
              label={style === 'gradient' ? 'Primary colour' : 'Role colour'}
              value={color}
              onChange={setColor}
              disabled={!editable}
              allowDefault={style === 'solid'}
            />
          ) : (
            <p className="text-[13px] text-muted">Holographic names shimmer in their own colours; the role colour below stays as the fallback.</p>
          )}
          {style === 'gradient' ? (
            <ColourRow label="Secondary colour" value={secondary} onChange={setSecondary} disabled={!editable} />
          ) : null}
          {style === 'holographic' ? (
            <ColourRow label="Fallback colour" value={color} onChange={setColor} disabled={!editable} allowDefault />
          ) : null}
          {gradientIncomplete ? (
            <p className="text-[13px] text-danger" role="alert">
              A gradient needs both colours.
            </p>
          ) : null}

          <div className="card-inset flex items-center gap-3 p-3" data-testid="role-preview">
            <Avatar src={me?.avatarUrl} name={me?.displayName ?? 'Member'} colorSeed={me?.id} size={36} />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5">
                <StyledName name={me?.displayName ?? 'Member'} role={draftRole} mode="full" className="truncate text-[15px] font-semibold" />
                <RoleIcon role={draftRole} size={16} />
              </p>
              <p className="text-[13px] text-muted">How names with this role look</p>
            </div>
          </div>
          {lowContrast ? (
            <p className="flex items-center gap-2 text-[13px] text-warning-ink" role="status" data-testid="contrast-warning">
              <AlertTriangle size={15} aria-hidden />
              This colour may be hard to read on the {surface.theme} theme.
            </p>
          ) : null}

          <div>
            <p className="mb-2 text-[14px] font-medium">Role Icon</p>
            <div className="card-inset flex flex-wrap items-center gap-3 p-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-surface-2" data-testid="role-icon-preview">
                <RoleIcon role={draftRole} size={24} />
              </span>
              <Input
                aria-label="Role icon emoji"
                value={emoji}
                maxLength={16}
                placeholder="Emoji, e.g. ⭐"
                disabled={!editable}
                onChange={(e) => setEmoji(e.target.value)}
                containerClassName="w-40"
              />
              <Button variant="soft" size="sm" leftIcon={ImagePlus} loading={uploading} disabled={!editable} onClick={() => fileRef.current?.click()}>
                Upload image
              </Button>
              {icon.url || emojiValue ? (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={X}
                  disabled={!editable}
                  onClick={() => {
                    setEmoji('');
                    setIcon(role.iconUrl ? { mediaId: null, url: null } : { url: null });
                  }}
                >
                  Remove icon
                </Button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                aria-label="Role icon image"
                onChange={(e) => void onIconFile(e)}
                data-testid="role-icon-input"
              />
              <p className="w-full text-[12px] text-muted">An image wins over the emoji. Shown next to names of members whose highest icon role this is.</p>
            </div>
          </div>
        </section>
      ) : (
        <p className="text-[14px] text-muted">@everyone: what every member can do. Roles add to it.</p>
      )}
      <div className="card-inset flex flex-col gap-1 p-2">
        {!role.isDefault ? (
          <Switch checked={hoist} onChange={setHoist} disabled={!editable} label="Show members separately" description="Members with this role get their own group in the member list." />
        ) : null}
        <Switch checked={mentionable} onChange={setMentionable} disabled={!editable} label={role.isDefault ? 'Anyone can use @everyone' : `Anyone can @mention this role`} description={role.isDefault ? 'Otherwise only members with “Mention @everyone” can.' : 'Otherwise only members with “Mention @everyone” can.'} />
      </div>
      {PERMISSION_GROUPS.map((g) => (
        <section key={g.title}>
          <h3 className="mb-1 text-[12px] font-bold tracking-wide text-muted uppercase">{g.title}</h3>
          <div className="card-inset flex flex-col gap-1 p-2">
            {g.items.map((p) => (
              <Switch
                key={p.bit}
                checked={(perms & p.bit) !== 0}
                disabled={!editable || (!isSpaceAdmin(space.myPermissions) && (grantable & p.bit) === 0)}
                onChange={(on) => setPerms((v) => (on ? v | p.bit : v & ~p.bit))}
                label={p.label}
                description={p.description}
              />
            ))}
          </div>
        </section>
      ))}
      <div className="sticky bottom-4 flex justify-end gap-2">
        {!role.isDefault && editable ? (
          <Button
            variant="ghost"
            leftIcon={Trash2}
            className="mr-auto text-danger"
            onClick={() =>
              void confirm({ title: `Delete ${role.name}?`, message: 'Members lose its permissions.', confirmLabel: 'Delete role', danger: true }).then(
                (ok) => ok && void deleteRole(space.id, role.id).catch((e: unknown) => toast.error(e)),
              )
            }
          >
            Delete role
          </Button>
        ) : null}
        <Button variant="ghost" disabled={!dirty} onClick={reset}>
          Reset
        </Button>
        <Button disabled={!dirty || !editable || gradientIncomplete || uploading} loading={busy} onClick={() => void save()} data-testid="save-role">
          Save changes
        </Button>
      </div>
    </div>
  );
}

/** Presets, "Default" (solid only) and the native picker for one role colour. */
function ColourRow({
  label,
  value,
  onChange,
  disabled,
  allowDefault,
}: {
  label: string;
  value: string | null;
  onChange: (c: string | null) => void;
  disabled?: boolean;
  allowDefault?: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-[14px] font-medium">{label}</p>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
        {allowDefault ? (
          <button type="button" aria-label="Default colour" aria-pressed={value === null} disabled={disabled} onClick={() => onChange(null)} className={cn('size-9 rounded-lg border-2 bg-surface-2', value === null ? 'border-fg' : 'border-transparent')} />
        ) : null}
        {COLORS.map((c) => (
          <button key={c} type="button" aria-label={c} aria-pressed={value === c} disabled={disabled} onClick={() => onChange(c)} className={cn('size-9 rounded-lg border-2', value === c ? 'border-fg' : 'border-transparent')} style={{ background: c }} />
        ))}
        <label className={cn('relative flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-line-strong', value && !COLORS.includes(value) && 'border-solid border-fg')} style={value && !COLORS.includes(value) ? { background: value } : undefined}>
          <input
            type="color"
            aria-label={`${label}: custom`}
            value={value ?? '#99aab5'}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
          <Plus size={14} className="pointer-events-none text-muted" aria-hidden />
        </label>
      </div>
    </div>
  );
}
