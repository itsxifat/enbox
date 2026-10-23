import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarDays, Volume2 } from 'lucide-react';
import type { Space, SpaceEvent } from '@enbox/shared';
import { useChats } from '@/stores/chats';
import { canCreateEvents, useEvents, useSpaceEvents } from '@/stores/events';
import { joinEvent } from './actions';
import { EventPlace } from './EventCard';
import { EventsModal, eventsLabel } from './EventsModal';

/** A started event at the top of the sidebar: green "Live", its name and place, Join for voice. */
function LiveEventCard({ event, onOpen }: { event: SpaceEvent; onOpen: () => void }) {
  const channel = useChats((s) => (event.channelId ? s.byId[event.channelId] : undefined));
  const joinable = event.entityType === 'voice' && channel?.type === 'space_voice';
  return (
    <div className="rounded-xl bg-success-soft px-3 py-2.5" data-testid="live-event-card">
      <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-success uppercase">
        <span aria-hidden className="size-2 rounded-full bg-success motion-safe:animate-pulse" />
        Live
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="mt-0.5 block w-full truncate text-left text-[15px] font-semibold text-fg hover:underline focus-visible:outline-2 focus-visible:outline-brand"
      >
        {event.name}
      </button>
      <EventPlace event={event} className="text-[13px]" />
      {joinable ? (
        <button
          type="button"
          onClick={() => joinEvent(event)}
          aria-label={`Join ${event.name}`}
          className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full bg-success px-3.5 text-sm font-semibold text-white transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Volume2 size={16} aria-hidden />
          Join
        </button>
      ) : null}
    </div>
  );
}

/**
 * The events part of a Space's channel sidebar, under its header (Discord): a "Live" card for
 * each started event, then the "N Events" row that opens the events modal — shown when there
 * are events, and always to members who can create them. It also hosts the modal and opens it
 * from an event link (`/spaces/:id?event=<eventId>`).
 */
export function SidebarEvents({ space }: { space: Space }) {
  const events = useSpaceEvents(space.id);
  const [params, setParams] = useSearchParams();
  const linked = params.get('event');
  useEffect(() => {
    if (!linked) return;
    useEvents.getState().openModal(space.id, { eventId: linked });
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('event');
        return next;
      },
      { replace: true },
    );
  }, [linked, space.id, setParams]);

  const count = events?.length ?? 0;
  const live = events?.filter((e) => e.status === 'active') ?? [];
  const open = (eventId?: string) => useEvents.getState().openModal(space.id, eventId ? { eventId } : {});
  const shown = count > 0 || canCreateEvents(space);
  return (
    <>
      {shown ? (
        <div className="flex shrink-0 flex-col gap-1 px-2 pb-1" data-testid="sidebar-events">
          {live.map((e) => (
            <LiveEventCard key={e.id} event={e} onOpen={() => open(e.id)} />
          ))}
          <button
            type="button"
            onClick={() => open()}
            className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-[15px] text-muted transition-colors outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-brand"
            data-testid="sidebar-events-row"
          >
            <CalendarDays size={18} className="shrink-0 opacity-70" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-left">{eventsLabel(count)}</span>
          </button>
        </div>
      ) : null}
      <EventsModal space={space} />
    </>
  );
}
