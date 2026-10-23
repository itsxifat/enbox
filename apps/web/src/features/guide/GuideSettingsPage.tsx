/**
 * Space Settings ▸ Server Guide (MANAGE_SPACE): switch it on, the welcome sign (title and
 * subtitle), up to GUIDE_MAX_TODOS new member to-dos (a channel, an emoji, what to do there)
 * and up to GUIDE_MAX_RESOURCES resource pages (a channel with a title, a description and an
 * emoji). Rows reorder by dragging their grip (or the arrows). Only text channels everyone can
 * see can be picked (the server checks too). One save sends the whole guide.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
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
import { GripVertical, Plus } from 'lucide-react';
import {
  GUIDE_MAX_RESOURCES,
  GUIDE_MAX_TODOS,
  type ChatSummary,
  type ID,
  type ServerGuide,
  type Space,
} from '@enbox/shared';
import { Button, Field, Input, Switch, Textarea, toast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { dndAccessibility } from '@/lib/dnd';
import { useSpaces } from '@/stores/spaces';
import {
  EmojiButton,
  RowActions,
  Section,
  UnsavedBar,
  moveItem,
  shortId,
} from '@/features/spaces/community/settings/shared';
import { useWelcomeCandidates } from '@/features/spaces/community/settings/WelcomeScreenPage';
import { saveGuide } from './actions';
import { GuideWelcome } from './parts';

const TITLE_MAX = 100;
const SUBTITLE_MAX = 300;
const TODO_MAX = 100;
const RESOURCE_TITLE_MAX = 60;
const RESOURCE_DESCRIPTION_MAX = 200;

export interface TodoDraft {
  /** A stable row key (not sent). */
  key: string;
  channelId: ID | '';
  emoji: string | null;
  description: string;
}

export interface ResourceDraft {
  key: string;
  channelId: ID | '';
  title: string;
  description: string;
  emoji: string | null;
}

export interface GuideDraft {
  enabled: boolean;
  title: string;
  subtitle: string;
  todos: TodoDraft[];
  resources: ResourceDraft[];
}

/** The draft of a Space's guide (none yet: off, titled after the Space). */
export function guideDraftOf(space: Pick<Space, 'name' | 'guide'>): GuideDraft {
  const g = space.guide;
  return {
    enabled: g?.enabled ?? false,
    title: g?.welcome.title ?? `Welcome to ${space.name}!`.slice(0, TITLE_MAX),
    subtitle: g?.welcome.subtitle ?? '',
    todos: (g?.todos ?? []).map((t) => ({ key: shortId('t'), ...t })),
    resources: (g?.resources ?? []).map((r) => ({
      key: shortId('r'),
      ...r,
      description: r.description ?? '',
    })),
  };
}

/** What a save sends. Pure. */
export function guideOf(d: GuideDraft): ServerGuide {
  return {
    enabled: d.enabled,
    welcome: { title: d.title.trim(), subtitle: d.subtitle.trim() || null },
    todos: d.todos.map((t) => ({
      channelId: t.channelId,
      emoji: t.emoji || null,
      description: t.description.trim(),
    })),
    resources: d.resources.map((r) => ({
      channelId: r.channelId,
      title: r.title.trim(),
      description: r.description.trim() || null,
      emoji: r.emoji || null,
    })),
  };
}

/** Why the draft cannot be saved (null = fine). Pure. */
export function guideProblem(d: GuideDraft): string | null {
  if (!d.title.trim()) return 'Give the welcome sign a title';
  if (d.todos.some((t) => !t.channelId)) return 'Pick a channel for every to-do';
  if (d.todos.some((t) => !t.description.trim())) return 'Say what to do in every to-do';
  if (new Set(d.todos.map((t) => t.channelId)).size !== d.todos.length)
    return 'Give each to-do its own channel';
  if (d.resources.some((r) => !r.channelId)) return 'Pick a channel for every resource page';
  if (d.resources.some((r) => !r.title.trim())) return 'Give every resource page a title';
  if (new Set(d.resources.map((r) => r.channelId)).size !== d.resources.length)
    return 'Give each resource page its own channel';
  return null;
}

/** A draft's content in a fixed shape (jsonb does not keep key order; row keys left out). */
const contentOf = (d: GuideDraft) => JSON.stringify(guideOf(d));

/** A row with a drag grip (pointer, or keyboard on the grip: Space, arrows, Space). */
function SortableRow({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: { label },
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'card-inset flex items-start gap-2 p-3',
        isDragging && 'relative z-10 shadow-elevated',
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Drag ${label}`}
        className="flex h-11 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-brand active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} aria-hidden />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </li>
  );
}

/** A sortable list of rows (one drag context per list). */
function SortableList<T extends { key: string }>({
  items,
  onReorder,
  label,
  children,
}: {
  items: readonly T[];
  onReorder: (next: T[]) => void;
  label: string;
  children: (item: T, index: number) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.key === active.id);
    const to = items.findIndex((i) => i.key === over.id);
    if (from >= 0 && to >= 0) onReorder(arrayMove([...items], from, to));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={dndAccessibility}
    >
      <SortableContext items={items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-2" aria-label={label}>
          {items.map((item, i) => children(item, i))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function ChannelPicker({
  value,
  label,
  candidates,
  taken,
  onChange,
}: {
  value: ID | '';
  label: string;
  candidates: readonly ChatSummary[];
  /** Channels other rows of the same list use. */
  taken: ReadonlySet<ID>;
  onChange: (id: ID) => void;
}) {
  const known = !value || candidates.some((c) => c.id === value);
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 min-w-0 flex-1 rounded-xl bg-surface px-3"
    >
      <option value="">Pick a channel</option>
      {known ? null : <option value={value}>Unavailable channel</option>}
      {candidates.map((ch) => (
        <option key={ch.id} value={ch.id} disabled={ch.id !== value && taken.has(ch.id)}>
          #{ch.name}
        </option>
      ))}
    </select>
  );
}

export function GuideSettingsPage({ space }: { space: Space }) {
  // Another Space's settings start from their own guide.
  return <GuideEditor key={space.id} space={space} />;
}

function GuideEditor({ space }: { space: Space }) {
  const [draft, setDraft] = useState(() => guideDraftOf(space));
  const saved = contentOf(guideDraftOf(space));
  /** The saved guide the draft started from. */
  const [base, setBase] = useState(saved);
  const [busy, setBusy] = useState(false);
  const candidates = useWelcomeCandidates(space);
  const loaded = useSpaces((s) => !!s.channelsLoaded[space.id]);
  useEffect(() => {
    if (!loaded)
      void useSpaces
        .getState()
        .loadSpace(space.id)
        .catch(() => undefined);
  }, [loaded, space.id]);

  // Saved meanwhile (another manager, or my own save): an untouched draft follows.
  if (saved !== base) {
    setBase(saved);
    if (contentOf(draft) === base) setDraft(guideDraftOf(space));
  }
  const dirty = contentOf(draft) !== saved;

  // A channel deleted or made private since: it has to be replaced.
  const names = new Set(candidates.map((c) => c.id));
  const gone =
    loaded &&
    [...draft.todos, ...draft.resources].some((r) => r.channelId && !names.has(r.channelId));
  const problem =
    guideProblem(draft) ??
    (gone ? 'Replace the channels that are gone or not visible to everyone' : null);

  const patch = (update: Partial<GuideDraft>) => setDraft((d) => ({ ...d, ...update }));
  const setTodos = (update: (list: TodoDraft[]) => TodoDraft[]) =>
    setDraft((d) => ({ ...d, todos: update(d.todos) }));
  const setResources = (update: (list: ResourceDraft[]) => ResourceDraft[]) =>
    setDraft((d) => ({ ...d, resources: update(d.resources) }));
  const patchTodo = (i: number, p: Partial<TodoDraft>) =>
    setTodos((l) => l.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const patchResource = (i: number, p: Partial<ResourceDraft>) =>
    setResources((l) => l.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const save = async () => {
    if (!dirty || busy || problem) return;
    setBusy(true);
    try {
      await saveGuide(space.id, guideOf(draft));
      toast.success('Changes saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (id: ID | '') => candidates.find((c) => c.id === id)?.name ?? 'channel';
  const takenBy = (list: readonly { channelId: ID | '' }[], i: number) =>
    new Set(
      list
        .filter((_, j) => j !== i)
        .map((x) => x.channelId)
        .filter((x): x is ID => !!x),
    );

  return (
    <div className="flex flex-col gap-8 pb-24" data-testid="guide-settings">
      <div className="card-inset flex flex-col px-3">
        <Switch
          checked={draft.enabled}
          onChange={(enabled) => patch({ enabled })}
          label="Show the Server Guide"
          description="Members find it at the top of the channel list: a welcome, to-dos to get started and the channels worth knowing."
        />
      </div>

      <Section
        title="Welcome sign"
        description="The banner at the top of the guide, with the Space’s icon and banner."
      >
        <Field label="Title" htmlFor="guide-title">
          <Input
            id="guide-title"
            maxLength={TITLE_MAX}
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </Field>
        <Field
          label="Subtitle"
          htmlFor="guide-subtitle"
          hint="A line or two about the Space (optional)."
        >
          <Textarea
            id="guide-subtitle"
            rows={2}
            maxLength={SUBTITLE_MAX}
            value={draft.subtitle}
            onChange={(e) => patch({ subtitle: e.target.value })}
          />
        </Field>
      </Section>

      <Section
        title={`New member to-dos — ${draft.todos.length}/${GUIDE_MAX_TODOS}`}
        description="Things to do first. Visiting a to-do’s channel ticks it off."
      >
        <SortableList items={draft.todos} onReorder={(todos) => patch({ todos })} label="To-dos">
          {(t, i) => (
            <SortableRow key={t.key} id={t.key} label={`to-do ${i + 1}`}>
              <div className="flex items-center gap-2">
                <EmojiButton
                  value={t.emoji}
                  onChange={(emoji) => patchTodo(i, { emoji })}
                  label="To-do emoji"
                />
                <ChannelPicker
                  value={t.channelId}
                  label={`Channel of to-do ${i + 1}`}
                  candidates={candidates}
                  taken={takenBy(draft.todos, i)}
                  onChange={(channelId) => patchTodo(i, { channelId })}
                />
                <RowActions
                  index={i}
                  count={draft.todos.length}
                  what="to-do"
                  onMove={(to) => setTodos((l) => moveItem(l, i, to))}
                  onRemove={() => setTodos((l) => l.filter((_, j) => j !== i))}
                />
              </div>
              <Input
                aria-label={`What to do in to-do ${i + 1}`}
                placeholder={
                  t.channelId
                    ? `e.g. Say hi in #${nameOf(t.channelId)}`
                    : 'What should new members do?'
                }
                maxLength={TODO_MAX}
                value={t.description}
                onChange={(e) => patchTodo(i, { description: e.target.value })}
              />
            </SortableRow>
          )}
        </SortableList>
        {draft.todos.length < GUIDE_MAX_TODOS ? (
          <div>
            <Button
              size="sm"
              variant="soft"
              leftIcon={Plus}
              onClick={() =>
                setTodos((l) => [
                  ...l,
                  { key: shortId('t'), channelId: '', emoji: null, description: '' },
                ])
              }
            >
              Add a to-do
            </Button>
          </div>
        ) : null}
      </Section>

      <Section
        title={`Resource pages — ${draft.resources.length}/${GUIDE_MAX_RESOURCES}`}
        description="Channels worth knowing, shown as cards: rules, FAQs, guides."
      >
        <SortableList
          items={draft.resources}
          onReorder={(resources) => patch({ resources })}
          label="Resource pages"
        >
          {(r, i) => (
            <SortableRow key={r.key} id={r.key} label={`resource page ${i + 1}`}>
              <div className="flex items-center gap-2">
                <EmojiButton
                  value={r.emoji}
                  onChange={(emoji) => patchResource(i, { emoji })}
                  label="Resource emoji"
                />
                <ChannelPicker
                  value={r.channelId}
                  label={`Channel of resource page ${i + 1}`}
                  candidates={candidates}
                  taken={takenBy(draft.resources, i)}
                  onChange={(channelId) => patchResource(i, { channelId })}
                />
                <RowActions
                  index={i}
                  count={draft.resources.length}
                  what="resource page"
                  onMove={(to) => setResources((l) => moveItem(l, i, to))}
                  onRemove={() => setResources((l) => l.filter((_, j) => j !== i))}
                />
              </div>
              <Input
                aria-label={`Title of resource page ${i + 1}`}
                placeholder="Title"
                maxLength={RESOURCE_TITLE_MAX}
                value={r.title}
                onChange={(e) => patchResource(i, { title: e.target.value })}
              />
              <Input
                aria-label={`Description of resource page ${i + 1}`}
                placeholder="What is in it? (optional)"
                maxLength={RESOURCE_DESCRIPTION_MAX}
                value={r.description}
                onChange={(e) => patchResource(i, { description: e.target.value })}
              />
            </SortableRow>
          )}
        </SortableList>
        {draft.resources.length < GUIDE_MAX_RESOURCES ? (
          <div>
            <Button
              size="sm"
              variant="soft"
              leftIcon={Plus}
              onClick={() =>
                setResources((l) => [
                  ...l,
                  { key: shortId('r'), channelId: '', title: '', description: '', emoji: null },
                ])
              }
            >
              Add a resource page
            </Button>
          </div>
        ) : null}
      </Section>

      <Section
        title="Preview"
        description={
          space.guide?.enabled ? (
            <Link
              to={`/spaces/${space.id}/guide`}
              className="font-semibold text-brand-ink hover:underline"
            >
              Open the Server Guide
            </Link>
          ) : undefined
        }
      >
        <div role="figure" aria-label="Welcome sign preview">
          <GuideWelcome
            space={space}
            title={draft.title.trim()}
            subtitle={draft.subtitle.trim() || null}
          />
        </div>
      </Section>

      <UnsavedBar
        editor={{ dirty, busy, save, reset: () => setDraft(guideDraftOf(space)) }}
        problem={problem}
      />
    </div>
  );
}
