/**
 * /spaces/:spaceId/guide — the Server Guide members see (Discord): the welcome sign, the new
 * member to-dos with my progress ("2 of 5"; visiting a to-do's channel ticks it, see
 * SidebarGuideLinks) and the resource pages. Each to-do and resource opens its channel.
 */
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Check, ChevronRight, Hash, Settings, Signpost } from 'lucide-react';
import {
  PERM,
  hasPerm,
  type ChatSummary,
  type GuideResource,
  type GuideTodo,
  type ID,
} from '@enbox/shared';
import { Button, EmptyState, IconButton, PageSpinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useChats } from '@/stores/chats';
import { useSpace, useSpaces } from '@/stores/spaces';
import { settingsPath } from '@/features/spaces/settings/sections';
import { guideProgress } from './actions';
import { GuidePane, GuideWelcome } from './parts';

function TodoRow({
  todo,
  channel,
  done,
  spaceId,
}: {
  todo: GuideTodo;
  channel: ChatSummary;
  done: boolean;
  spaceId: ID;
}) {
  return (
    <li>
      <Link
        to={`/spaces/${spaceId}/${channel.id}`}
        className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-3 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
        data-testid="guide-todo"
        data-done={done || undefined}
      >
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full border-2',
            done ? 'border-brand bg-brand text-on-brand' : 'border-line-strong',
          )}
          aria-hidden
        >
          {done ? <Check size={14} strokeWidth={3} /> : null}
        </span>
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-[20px] text-muted"
          aria-hidden
        >
          {todo.emoji || <Hash size={20} />}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block text-[15px] font-semibold break-words',
              done ? 'text-muted line-through' : 'text-fg',
            )}
          >
            {todo.description}
          </span>
          <span className="block truncate text-[13px] text-muted">#{channel.name}</span>
        </span>
        <span className="sr-only">{done ? 'Done' : 'Not done yet'}</span>
        <ChevronRight size={18} className="shrink-0 text-subtle" aria-hidden />
      </Link>
    </li>
  );
}

function ResourceCard({
  resource,
  channel,
  spaceId,
}: {
  resource: GuideResource;
  channel: ChatSummary;
  spaceId: ID;
}) {
  return (
    <li>
      <Link
        to={`/spaces/${spaceId}/${channel.id}`}
        className="flex h-full flex-col gap-2 rounded-2xl bg-surface-2 p-4 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
        data-testid="guide-resource"
      >
        <span
          className="flex size-11 items-center justify-center rounded-xl bg-surface text-[22px] text-muted"
          aria-hidden
        >
          {resource.emoji || <Hash size={22} />}
        </span>
        <span className="text-[16px] font-bold break-words text-fg">{resource.title}</span>
        {resource.description ? (
          <span className="text-[14px] break-words text-muted">{resource.description}</span>
        ) : null}
        <span className="mt-auto truncate pt-1 text-[13px] text-subtle">#{channel.name}</span>
      </Link>
    </li>
  );
}

export function ServerGuidePage() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const space = useSpace(spaceId);
  const loaded = useSpaces((s) => s.loaded);
  const channelsLoaded = useSpaces((s) => (spaceId ? !!s.channelsLoaded[spaceId] : false));
  const byId = useChats((s) => s.byId);
  const navigate = useNavigate();
  if (!space) return loaded ? <Navigate to="/spaces" replace /> : <PageSpinner />;

  const guide = space.guide?.enabled ? space.guide : null;
  const canManage = hasPerm(space.myPermissions, PERM.MANAGE_SPACE);
  const settings = canManage ? (
    <IconButton
      icon={Settings}
      label="Edit the Server Guide"
      variant="ghost"
      onClick={() => navigate(settingsPath(space.id, 'guide'))}
    />
  ) : null;
  if (!guide)
    return (
      <GuidePane
        space={space}
        title="Server Guide"
        icon={Signpost}
        actions={settings}
        testId="server-guide"
      >
        <EmptyState
          icon={Signpost}
          title="No Server Guide yet"
          description={
            canManage
              ? 'Welcome new members with a guide: to-dos to get started and the channels worth knowing. Set it up in Space Settings.'
              : 'This Space has no guide for new members.'
          }
          action={
            canManage ? (
              <Button variant="soft" onClick={() => navigate(settingsPath(space.id, 'guide'))}>
                Set up the Server Guide
              </Button>
            ) : undefined
          }
        />
      </GuidePane>
    );

  // The channels I can see (to-dos and resources only name channels everyone can see).
  const withChannel = <T extends { channelId: ID }>(list: readonly T[]) =>
    list.flatMap((item) => {
      const channel = byId[item.channelId];
      return channel ? [{ item, channel }] : [];
    });
  const todos = withChannel(guide.todos);
  const resources = withChannel(guide.resources);
  const done = new Set(space.me.guideDone ?? []);
  const progress = guideProgress(guide, space.me.guideDone);

  return (
    <GuidePane
      space={space}
      title="Server Guide"
      icon={Signpost}
      actions={settings}
      testId="server-guide"
    >
      <GuideWelcome space={space} title={guide.welcome.title} subtitle={guide.welcome.subtitle} />
      {!channelsLoaded ? <PageSpinner /> : null}
      {channelsLoaded && todos.length ? (
        <section aria-labelledby="guide-todos" className="flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <h3
              id="guide-todos"
              className="flex-1 text-[12px] font-bold tracking-wide text-muted uppercase"
            >
              New member to-dos
            </h3>
            <span className="text-[13px] font-semibold text-muted" data-testid="guide-progress">
              {progress.done} of {progress.total}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="To-dos done"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            className="h-1.5 overflow-hidden rounded-full bg-surface-2"
          >
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-300"
              style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
            />
          </div>
          {progress.total > 0 && progress.done >= progress.total ? (
            <p className="text-[14px] font-medium text-fg">You did them all. Welcome aboard!</p>
          ) : null}
          <ol className="flex flex-col gap-2">
            {todos.map(({ item, channel }) => (
              <TodoRow
                key={item.channelId}
                todo={item}
                channel={channel}
                done={done.has(item.channelId)}
                spaceId={space.id}
              />
            ))}
          </ol>
        </section>
      ) : null}
      {channelsLoaded && resources.length ? (
        <section aria-labelledby="guide-resources" className="flex flex-col gap-3">
          <h3
            id="guide-resources"
            className="text-[12px] font-bold tracking-wide text-muted uppercase"
          >
            Resource pages
          </h3>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {resources.map(({ item, channel }) => (
              <ResourceCard
                key={item.channelId}
                resource={item}
                channel={channel}
                spaceId={space.id}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </GuidePane>
  );
}
