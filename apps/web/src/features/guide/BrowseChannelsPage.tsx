/**
 * /spaces/:spaceId/browse — Browse Channels (Discord): every channel I can see, by category,
 * each with a Show checkbox (a category's box shows or hides all of it). Opt-in channels start
 * unticked. Changes show in the sidebar at once and are saved in one batch; Show All Channels
 * (this device) lists everything whatever the boxes say. Seeing a channel is still up to its
 * permissions: hiding only tidies my sidebar.
 */
import { useEffect, useMemo } from 'react';
import { Navigate, useParams } from 'react-router';
import { Hash, Images, Megaphone, MessagesSquare, Podcast, TextSearch, Volume2 } from 'lucide-react';
import type { ChatSummary, ID } from '@enbox/shared';
import { Checkbox, EmptyState, PageSpinner, Switch } from '@/components/ui';
import { useSpace, useSpaceChannels, useSpaces } from '@/stores/spaces';
import { groupsOf, shownByPrefs } from '@/features/spaces/sidebar';
import { flushChannelPrefs, setChannelsShown } from './actions';
import { GuidePane } from './parts';
import { setShowAllChannels, useShowAllChannels } from './showAll';

function channelIcon(c: ChatSummary) {
  if (c.type === 'space_stage') return Podcast;
  if (c.type === 'space_voice') return Volume2;
  if (c.type === 'space_forum') return c.space?.forum?.settings.media ? Images : MessagesSquare;
  return c.space?.isNews ? Megaphone : Hash;
}

function ChannelRow({
  chat,
  shown,
  onChange,
}: {
  chat: ChatSummary;
  shown: boolean;
  onChange: (shown: boolean) => void;
}) {
  const Icon = channelIcon(chat);
  return (
    <li
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-hover"
      data-testid="browse-channel"
    >
      <Icon size={20} className="shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-fg">{chat.name}</span>
        {chat.space?.topic ? (
          <span className="block truncate text-[13px] text-muted">{chat.space.topic}</span>
        ) : null}
      </span>
      {chat.space?.optIn ? (
        <span className="hidden shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted sm:inline">
          Optional
        </span>
      ) : null}
      <Checkbox checked={shown} onChange={onChange} aria-label={`Show ${chat.name}`} />
    </li>
  );
}

export function BrowseChannelsPage() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const space = useSpace(spaceId);
  const loaded = useSpaces((s) => s.loaded);
  const channelsLoaded = useSpaces((s) => (spaceId ? !!s.channelsLoaded[spaceId] : false));
  const channels = useSpaceChannels(spaceId);
  const showAll = useShowAllChannels(spaceId);
  const prefs = space?.me.channelPrefs;
  const shownMap = useMemo(
    () => new Map((prefs ?? []).map((p) => [p.channelId, p.shown])),
    [prefs],
  );
  const groups = useMemo(
    () => (space ? groupsOf(space, channels).filter((g) => g.channels.length > 0) : []),
    [space, channels],
  );

  // Leaving the page sends what is still waiting for the batch.
  useEffect(() => {
    if (!spaceId) return;
    return () => void flushChannelPrefs(spaceId);
  }, [spaceId]);

  if (!space) return loaded ? <Navigate to="/spaces" replace /> : <PageSpinner />;
  const isShown = (c: ChatSummary) => shownByPrefs(c, shownMap);
  const set = (list: readonly ChatSummary[], shown: boolean) =>
    setChannelsShown(space.id, Object.fromEntries(list.map((c): [ID, boolean] => [c.id, shown])));
  const count = channels.filter(isShown).length;

  return (
    <GuidePane space={space} title="Browse Channels" icon={TextSearch} testId="browse-channels">
      <div className="flex flex-col gap-1">
        <p className="text-[15px] text-muted">
          Pick the channels you want in your channel list. Hidden ones are still yours to open from
          here, search and links.
        </p>
        <div className="card-inset mt-3 flex flex-col px-3">
          <Switch
            checked={showAll}
            onChange={(on) => setShowAllChannels(space.id, on)}
            label="Show All Channels"
            description="List every channel you can see on this device, whatever is picked below."
          />
        </div>
      </div>
      {!channelsLoaded ? (
        <PageSpinner />
      ) : groups.length === 0 ? (
        <EmptyState icon={TextSearch} title="No channels you can see yet" />
      ) : (
        <div className="flex flex-col gap-6">
          <p className="text-[13px] font-semibold text-muted" data-testid="browse-count">
            {count} of {channels.length} channels shown
          </p>
          {groups.map((g) => {
            const on = g.channels.filter(isShown).length;
            const name = g.category?.name ?? 'No category';
            return (
              <section
                key={g.category?.id ?? 'none'}
                aria-label={name}
                className="flex flex-col gap-1"
              >
                <div className="flex items-center gap-3 px-3">
                  <h3 className="min-w-0 flex-1 truncate text-[12px] font-bold tracking-wide text-muted uppercase">
                    {name}
                  </h3>
                  <span className="text-[12px] text-subtle">
                    {on}/{g.channels.length}
                  </span>
                  <Checkbox
                    checked={on === g.channels.length}
                    indeterminate={on > 0 && on < g.channels.length}
                    onChange={() => set(g.channels, on < g.channels.length)}
                    aria-label={`Show all of ${name}`}
                  />
                </div>
                <ul className="flex flex-col">
                  {g.channels.map((c) => (
                    <ChannelRow
                      key={c.id}
                      chat={c}
                      shown={isShown(c)}
                      onChange={(v) => set([c], v)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </GuidePane>
  );
}
