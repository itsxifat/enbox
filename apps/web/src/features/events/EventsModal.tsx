import { Suspense, useEffect, useState } from 'react';
import { CalendarDays, CalendarPlus } from 'lucide-react';
import type { Space, SpaceEvent } from '@enbox/shared';
import { Button, Modal, Spinner } from '@/components/ui';
import {
  canCreateEvents,
  useEvents,
  useSpaceEvents,
  type EventsModal as ModalState,
} from '@/stores/events';
import { lazyNamed } from '@/lib/lazy';
import { EventCard } from './EventCard';

// The wizard (with the cover cropper) loads when an event is created or edited.
const CreateEventWizard = lazyNamed(() => import('./CreateEventWizard'), 'CreateEventWizard');

/** "3 Events", "1 Event", or "Events" when there are none. */
export function eventsLabel(count: number): string {
  return count === 0 ? 'Events' : `${count} Event${count === 1 ? '' : 's'}`;
}

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; event: SpaceEvent };

function EventsDialog({ space, modal }: { space: Space; modal: ModalState }) {
  const events = useSpaceEvents(space.id);
  const [view, setView] = useState<View>(modal.create ? { kind: 'create' } : { kind: 'list' });
  const [focusId, setFocusId] = useState<string | undefined>(modal.eventId);
  const close = () => useEvents.getState().closeModal();
  const canCreate = canCreateEvents(space);
  const focused = focusId ? events?.find((e) => e.id === focusId) : undefined;

  useEffect(() => {
    if (view.kind === 'list' && focused)
      document.getElementById(`event-${focused.id}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [view.kind, focused]);

  if (view.kind !== 'list')
    return (
      <Suspense fallback={null}>
        <CreateEventWizard
          space={space}
          event={view.kind === 'edit' ? view.event : undefined}
          // Opened straight on the wizard (e.g. from a Space menu): closing it closes everything.
          onClose={modal.create && view.kind === 'create' ? close : () => setView({ kind: 'list' })}
          onSaved={(saved) => {
            setFocusId(saved.id);
            setView({ kind: 'list' });
          }}
        />
      </Suspense>
    );

  const count = events?.length ?? 0;
  return (
    <Modal
      open
      onClose={close}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <CalendarDays size={20} aria-hidden />
          {eventsLabel(count)}
        </span>
      }
      footer={
        canCreate ? (
          <Button leftIcon={CalendarPlus} onClick={() => setView({ kind: 'create' })}>
            Create Event
          </Button>
        ) : undefined
      }
    >
      {focusId && events && !focused ? (
        <p className="card-inset mb-3 px-4 py-3 text-[14px] text-muted" role="status">
          This event has ended or was removed.
        </p>
      ) : null}
      {events === null ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : count === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-surface-2 text-muted">
            <CalendarDays size={28} aria-hidden />
          </span>
          <p className="text-[16px] font-semibold text-fg">There are no upcoming events.</p>
          <p className="max-w-sm text-[14px] text-muted">
            {canCreate
              ? 'Schedule an event for any planned activity in your Space.'
              : 'Events scheduled in this Space show up here.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          {events.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              space={space}
              highlighted={e.id === focusId}
              onEdit={(ev) => setView({ kind: 'edit', event: ev })}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}

/** The events modal of a Space, while the store says it is open for it. */
export function EventsModal({ space }: { space: Space }) {
  const modal = useEvents((s) => (s.modal?.spaceId === space.id ? s.modal : null));
  if (!modal) return null;
  // A new open (another event, the wizard) starts fresh.
  return (
    <EventsDialog
      key={`${modal.eventId ?? ''}|${modal.create ? 'c' : ''}`}
      space={space}
      modal={modal}
    />
  );
}
