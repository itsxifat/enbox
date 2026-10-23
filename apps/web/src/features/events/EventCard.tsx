import {
  Bell,
  BellRing,
  CalendarDays,
  CalendarX,
  CircleStop,
  Ellipsis,
  Link2,
  MapPin,
  Pencil,
  Play,
  Trash2,
  Users,
  Volume2,
} from 'lucide-react';
import { userDisplayName, type Space, type SpaceEvent } from '@enbox/shared';
import { Avatar, Button, DropdownMenu, IconButton, type MenuEntry } from '@/components/ui';
import { tidy } from '@/features/spaces/menus';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { canManageEvent, canStartEvent } from '@/stores/events';
import { useUser } from '@/stores/users';
import {
  cancelEvent,
  copyEventLink,
  deleteEvent,
  endEvent,
  joinEvent,
  startEvent,
  toggleInterested,
} from './actions';
import { formatEventDate } from './format';

/** A link location (an external event's place may be a URL) opens in a new tab. */
const isLink = (s: string) => /^https?:\/\/\S+$/i.test(s);

/** The "…" menu of an event: what I may do with it (organizers) and its link (everyone). */
export function eventMenuItems(
  event: SpaceEvent,
  opts: { canManage: boolean; onEdit?: (event: SpaceEvent) => void; now?: number },
): MenuEntry[] {
  const { canManage } = opts;
  const scheduled = event.status === 'scheduled';
  return tidy([
    canManage && opts.onEdit && { label: 'Edit Event', icon: Pencil, onSelect: () => opts.onEdit!(event) },
    canManage &&
      canStartEvent(event, opts.now) && { label: 'Start Event', icon: Play, onSelect: () => void startEvent(event) },
    canManage &&
      event.status === 'active' && { label: 'End Event', icon: CircleStop, danger: true, onSelect: () => void endEvent(event) },
    canManage && scheduled && { label: 'Cancel Event', icon: CalendarX, danger: true, onSelect: () => void cancelEvent(event) },
    'separator',
    { label: 'Copy Link', icon: Link2, onSelect: () => void copyEventLink(event) },
    canManage && 'separator',
    canManage && { label: 'Delete Event', icon: Trash2, danger: true, onSelect: () => void deleteEvent(event) },
  ]);
}

/** Where it happens: the voice channel's name, or the place (a link when it is one). */
export function EventPlace({ event, className }: { event: SpaceEvent; className?: string }) {
  const channel = useChats((s) => (event.channelId ? s.byId[event.channelId] : undefined));
  const voice = event.entityType === 'voice';
  const Icon = voice ? Volume2 : MapPin;
  const label = voice ? (channel?.name ?? (event.channelId ? 'Voice channel' : 'Deleted channel')) : (event.location ?? '');
  return (
    <p className={cn('flex min-w-0 items-center gap-1.5 text-[14px] text-muted', className)} data-testid="event-place">
      <Icon size={16} className="shrink-0" aria-hidden />
      {!voice && isLink(label) ? (
        <a href={label} target="_blank" rel="noopener noreferrer" className="truncate text-link hover:underline">
          {label}
        </a>
      ) : (
        <span className="truncate">{label}</span>
      )}
    </p>
  );
}

export interface EventCardProps {
  event: SpaceEvent;
  space: Space;
  /** Ringed (opened from a link or a reminder). */
  highlighted?: boolean;
  /** The wizard's review: the card without its actions. */
  preview?: boolean;
  onEdit?: (event: SpaceEvent) => void;
}

/**
 * One event (Discord's event card): the cover or a colour band, the date line ("Live now"
 * once started), name, description, where, who created it, the Interested count and toggle,
 * Join for a live voice event, and the "…" menu.
 */
export function EventCard({ event, space, highlighted, preview, onEdit }: EventCardProps) {
  const meId = useAuth((s) => s.user?.id);
  const creator = useUser(event.creatorId);
  const channel = useChats((s) => (event.channelId ? s.byId[event.channelId] : undefined));
  const canManage = canManageEvent(space, event, meId);
  const live = event.status === 'active';
  const joinable = live && event.entityType === 'voice' && channel?.type === 'space_voice';
  const creatorName = event.creatorId ? userDisplayName(creator) : 'Deleted User';
  return (
    <article
      id={`event-${event.id}`}
      aria-label={event.name}
      data-testid="event-card"
      className={cn('card-inset flex flex-col overflow-hidden', highlighted && 'ring-2 ring-brand')}
    >
      {event.imageUrl ? (
        <img src={mediaUrl(event.imageUrl)} alt="" className="aspect-[5/2] w-full object-cover" />
      ) : (
        <div aria-hidden className="h-2 shrink-0 bg-brand" data-testid="event-band" />
      )}
      <div className="flex flex-col gap-1 px-4 pt-3">
        <div className="flex min-h-6 items-center gap-2">
          {live ? (
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-success">
              <span aria-hidden className="size-2 rounded-full bg-success" />
              Live now
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted" data-testid="event-date">
              <CalendarDays size={16} aria-hidden />
              {formatEventDate(event.startAt)}
            </span>
          )}
          <span className="flex-1" />
          <span title={`Created by ${creatorName}`} className="shrink-0">
            <Avatar src={creator?.avatarUrl} name={creatorName} colorSeed={event.creatorId ?? event.id} size={24} />
          </span>
        </div>
        <h3 className="text-[17px] leading-snug font-bold break-words text-fg">{event.name}</h3>
        {event.description ? (
          <p className="line-clamp-3 text-[14px] whitespace-pre-wrap text-muted">{event.description}</p>
        ) : null}
        <EventPlace event={event} className="mt-1" />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-3">
        <span className="flex items-center gap-1 text-[13px] text-muted" data-testid="event-interested-count">
          <Users size={15} aria-hidden />
          {event.interestedCount} Interested
        </span>
        <span className="flex-1" />
        {preview ? null : (
          <>
            <DropdownMenu
              aria-label={`${event.name} menu`}
              items={eventMenuItems(event, { canManage, onEdit })}
              trigger={(p) => <IconButton {...p} icon={Ellipsis} label="More options" size="sm" />}
            />
            {joinable ? (
              <button
                type="button"
                onClick={() => joinEvent(event)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-success px-3.5 text-sm font-semibold text-white transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <Volume2 size={16} aria-hidden />
                Join
              </button>
            ) : null}
            <Button
              size="sm"
              variant={event.interested ? 'soft' : 'secondary'}
              leftIcon={event.interested ? BellRing : Bell}
              aria-pressed={event.interested}
              onClick={() => void toggleInterested(event)}
            >
              Interested
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
