import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ImageUp, MapPin, Trash2, Volume2 } from 'lucide-react';
import {
  isVoiceChannelType,
  BANNER_MIME_TYPES,
  EVENT_DESCRIPTION_MAX_LENGTH,
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_NAME_MAX_LENGTH,
  hasPerm,
  PERM,
  type ChatSummary,
  type CreateSpaceEventRequest,
  type Space,
  type SpaceEvent,
  type SpaceEventEntity,
  type UpdateSpaceEventRequest,
} from '@enbox/shared';
import { Button, Field, Input, Modal, Textarea, toast } from '@/components/ui';
import { BannerCropDialog } from '@/features/settings/profile/BannerCropDialog';
import { fieldErrors, mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { useEvents } from '@/stores/events';
import { useSpaceChannels } from '@/stores/spaces';
import { EventCard } from './EventCard';
import { defaultEventStart, fromInputs, toDateInput, toTimeInput } from './format';

/** How far ahead an event may be scheduled (the server's rule). */
const MAX_AHEAD_MS = 365 * 24 * 3600_000;
const STEPS = ['Location', 'Event Info', 'Review'] as const;
export type WizardStep = 0 | 1 | 2;

/** The wizard's form state (dates and times as `<input>` values, local time). */
export interface EventDraft {
  entityType: SpaceEventEntity;
  channelId: string;
  location: string;
  name: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  description: string;
  /** A cover uploaded in this wizard. */
  image: { id: string; url: string } | null;
  /** Remove the event's current cover. */
  removeImage: boolean;
}

export type DraftField = 'channelId' | 'location' | 'name' | 'startAt' | 'endAt';
export type DraftErrors = Partial<Record<DraftField, string>>;

/** The voice channels and Stages of the Space that I can see. */
export function voiceChannelsOf(channels: readonly ChatSummary[]): ChatSummary[] {
  return channels.filter((c) => isVoiceChannelType(c.type) && hasPerm(c.spacePermissions, PERM.VIEW_CHANNEL));
}

/** A new event (voice, the first voice channel, the next full hour) or the event being edited. */
export function draftOf(event: SpaceEvent | undefined, voice: readonly ChatSummary[], now = new Date()): EventDraft {
  if (!event) {
    const start = defaultEventStart(now);
    return {
      entityType: voice.length ? 'voice' : 'external',
      channelId: voice[0]?.id ?? '',
      location: '',
      name: '',
      startDate: toDateInput(start),
      startTime: toTimeInput(start),
      endDate: '',
      endTime: '',
      description: '',
      image: null,
      removeImage: false,
    };
  }
  const start = new Date(event.startAt);
  const end = event.endAt ? new Date(event.endAt) : null;
  return {
    entityType: event.entityType,
    channelId: event.channelId ?? '',
    location: event.location ?? '',
    name: event.name,
    startDate: toDateInput(start),
    startTime: toTimeInput(start),
    endDate: end ? toDateInput(end) : '',
    endTime: end ? toTimeInput(end) : '',
    description: event.description ?? '',
    image: null,
    removeImage: false,
  };
}

const minute = (ms: number) => Math.floor(ms / 60_000);

/**
 * The problems of one step: 0 (where: a voice channel, or a location), 1 (the topic, a
 * start in the future and at most a year ahead, an end after it — required somewhere else).
 * Editing, an unchanged start is not checked again (a live event's cannot change at all).
 */
export function draftErrors(
  step: WizardStep,
  d: EventDraft,
  opts: { now?: number; event?: SpaceEvent } = {},
): DraftErrors {
  const out: DraftErrors = {};
  if (step === 0) {
    if (d.entityType === 'voice' && !d.channelId) out.channelId = 'Pick a voice channel';
    if (d.entityType === 'external' && !d.location.trim()) out.location = 'Enter a location';
    return out;
  }
  if (step !== 1) return out;
  const now = opts.now ?? Date.now();
  if (!d.name.trim()) out.name = 'Give your event a topic';
  const start = fromInputs(d.startDate, d.startTime);
  const moved = !opts.event || !start || minute(start.getTime()) !== minute(Date.parse(opts.event.startAt));
  if (!start) out.startAt = 'Pick a start date and time';
  else if (moved && start.getTime() <= now) out.startAt = 'The start time must be in the future';
  else if (moved && start.getTime() > now + MAX_AHEAD_MS) out.startAt = 'Events can be scheduled at most a year ahead';
  const endGiven = !!(d.endDate || d.endTime);
  const end = fromInputs(d.endDate, d.endTime);
  if (endGiven && !end) out.endAt = 'Pick an end date and time';
  else if (!end && d.entityType === 'external') out.endAt = 'Events somewhere else need an end time';
  else if (end && start && end.getTime() <= start.getTime()) out.endAt = 'The end time must be after the start time';
  return out;
}

/** The create request of a valid draft. */
export function requestOf(d: EventDraft): CreateSpaceEventRequest {
  const end = fromInputs(d.endDate, d.endTime);
  return {
    name: d.name.trim(),
    description: d.description.trim() || null,
    entityType: d.entityType,
    channelId: d.entityType === 'voice' ? d.channelId : null,
    location: d.entityType === 'external' ? d.location.trim() : null,
    startAt: fromInputs(d.startDate, d.startTime)!.toISOString(),
    endAt: end ? end.toISOString() : null,
    imageMediaId: d.image?.id ?? null,
  };
}

/** The edit request: only what changed (a live event never sends its start). */
export function changesOf(event: SpaceEvent, d: EventDraft): UpdateSpaceEventRequest {
  const next = requestOf(d);
  const out: UpdateSpaceEventRequest = {};
  if (next.name !== event.name) out.name = next.name;
  if ((next.description ?? null) !== event.description) out.description = next.description ?? null;
  if (next.entityType !== event.entityType) out.entityType = next.entityType;
  if ((next.channelId ?? null) !== event.channelId) out.channelId = next.channelId ?? null;
  if ((next.location ?? null) !== event.location) out.location = next.location ?? null;
  if (event.status === 'scheduled' && minute(Date.parse(next.startAt)) !== minute(Date.parse(event.startAt)))
    out.startAt = next.startAt;
  const was = event.endAt ? minute(Date.parse(event.endAt)) : null;
  const is = next.endAt ? minute(Date.parse(next.endAt)) : null;
  if (is !== was) out.endAt = next.endAt ?? null;
  if (d.image) out.imageMediaId = d.image.id;
  else if (d.removeImage && event.imageUrl) out.imageMediaId = null;
  return out;
}

/** Which step a server field error belongs to. */
const STEP_OF: Record<DraftField, WizardStep> = { channelId: 0, location: 0, name: 1, startAt: 1, endAt: 1 };

function Steps({ step }: { step: WizardStep }) {
  return (
    <ol className="mb-4 grid grid-cols-3 gap-2" aria-label="Steps">
      {STEPS.map((label, i) => (
        <li key={label} aria-current={i === step ? 'step' : undefined} className="flex flex-col gap-1.5">
          <span aria-hidden className={cn('h-1 rounded-full', i <= step ? 'bg-brand' : 'bg-line-strong')} />
          <span className={cn('text-[12px] font-semibold', i === step ? 'text-fg' : 'text-muted')}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

function PlaceOption({
  value,
  current,
  icon: Icon,
  title,
  description,
  onPick,
  disabled,
}: {
  value: SpaceEventEntity;
  current: SpaceEventEntity;
  icon: typeof Volume2;
  title: string;
  description: string;
  onPick: (v: SpaceEventEntity) => void;
  disabled?: boolean;
}) {
  const checked = value === current;
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 transition-colors',
        checked ? 'bg-selected' : 'bg-surface-2 hover:bg-hover',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <Icon size={22} className="shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-fg">{title}</span>
        <span className="block text-[13px] text-muted">{description}</span>
      </span>
      <input
        type="radio"
        name="event-place"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onPick(value)}
        className="size-5 shrink-0 accent-[var(--brand)]"
      />
    </label>
  );
}

const selectClass = 'h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-[15px] text-fg';

function DateTimeRow({
  idPrefix,
  label,
  date,
  time,
  onDate,
  onTime,
  error,
  disabled,
  optional,
}: {
  idPrefix: string;
  label: string;
  date: string;
  time: string;
  onDate: (v: string) => void;
  onTime: (v: string) => void;
  error?: string;
  disabled?: boolean;
  optional?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium text-fg">
        {label}
        {optional ? <span className="font-normal text-muted"> (optional)</span> : null}
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <Input
          id={`${idPrefix}-date`}
          type="date"
          aria-label={`${label} date`}
          value={date}
          onChange={(e) => onDate(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
        <Input
          id={`${idPrefix}-time`}
          type="time"
          aria-label={`${label} time`}
          value={time}
          onChange={(e) => onTime(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export interface CreateEventWizardProps {
  space: Space;
  /** Edit this event instead of creating one. */
  event?: SpaceEvent;
  onClose: () => void;
  onSaved: (event: SpaceEvent) => void;
}

/**
 * Discord's 3-step event modal: 1. where (a voice channel, or somewhere else with a
 * location), 2. the topic, start, end (required somewhere else), description and cover
 * (a 5:2 banner upload), 3. a preview of the card, then Create (or Save when editing).
 */
export function CreateEventWizard({ space, event, onClose, onSaved }: CreateEventWizardProps) {
  const channels = useSpaceChannels(space.id);
  const voice = useMemo(() => voiceChannelsOf(channels), [channels]);
  const meId = useAuth((s) => s.user?.id ?? null);
  const [step, setStep] = useState<WizardStep>(0);
  const [draft, setDraft] = useState<EventDraft>(() => draftOf(event, voice));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const live = event?.status === 'active';

  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => {
      const field: Partial<Record<keyof EventDraft, DraftField>> = {
        channelId: 'channelId',
        location: 'location',
        name: 'name',
        startDate: 'startAt',
        startTime: 'startAt',
        endDate: 'endAt',
        endTime: 'endAt',
      };
      const f = field[key];
      if (!f || !e[f]) return e;
      const { [f]: _gone, ...rest } = e;
      return rest;
    });
  };

  const next = () => {
    const found = draftErrors(step, draft, { event });
    setErrors(found);
    if (Object.keys(found).length === 0) setStep((s) => (s + 1) as WizardStep);
  };

  const submit = async () => {
    // Times move on while the wizard is open: check both steps again.
    for (const s of [0, 1] as const) {
      const found = draftErrors(s, draft, { event });
      if (Object.keys(found).length) {
        setErrors(found);
        setStep(s);
        return;
      }
    }
    setBusy(true);
    try {
      const store = useEvents.getState();
      let saved: SpaceEvent;
      if (event) {
        const changes = changesOf(event, draft);
        saved = Object.keys(changes).length ? await store.update(space.id, event.id, changes) : event;
      } else {
        saved = await store.create(space.id, requestOf(draft));
      }
      toast.success(event ? 'Event saved' : 'Event created');
      onSaved(saved);
    } catch (e) {
      const fields = fieldErrors(e);
      const known = (Object.keys(fields) as DraftField[]).filter((f) => f in STEP_OF);
      if (known.length) {
        setErrors(Object.fromEntries(known.map((f) => [f, fields[f]])) as DraftErrors);
        setStep(STEP_OF[known[0]!]);
      } else toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const coverUrl = draft.image?.url ?? (draft.removeImage ? null : (event?.imageUrl ?? null));
  const preview: SpaceEvent = {
    id: event?.id ?? 'preview',
    spaceId: space.id,
    channelId: draft.entityType === 'voice' ? draft.channelId || null : null,
    creatorId: event ? event.creatorId : meId,
    name: draft.name.trim() || 'Untitled event',
    description: draft.description.trim() || null,
    entityType: draft.entityType,
    location: draft.entityType === 'external' ? draft.location.trim() : null,
    startAt: (fromInputs(draft.startDate, draft.startTime) ?? new Date()).toISOString(),
    endAt: fromInputs(draft.endDate, draft.endTime)?.toISOString() ?? null,
    status: event?.status ?? 'scheduled',
    imageUrl: coverUrl,
    interestedCount: event?.interestedCount ?? 1,
    interested: event?.interested ?? true,
  };

  let body: ReactNode;
  if (step === 0) {
    body = (
      <div className="flex flex-col gap-4">
        <p className="text-[14px] text-muted">So no one gets lost on where to go.</p>
        <fieldset className="flex flex-col gap-2" disabled={live}>
          <legend className="sr-only">Where is your event?</legend>
          <PlaceOption
            value="voice"
            current={draft.entityType}
            icon={Volume2}
            title="Voice Channel"
            description="Hang out with voice, video and screen share."
            onPick={(v) => set('entityType', v)}
            disabled={live}
          />
          <PlaceOption
            value="external"
            current={draft.entityType}
            icon={MapPin}
            title="Somewhere Else"
            description="A text channel, an external link or an in-person place."
            onPick={(v) => set('entityType', v)}
            disabled={live}
          />
        </fieldset>
        {draft.entityType === 'voice' ? (
          <Field label="Select a channel" htmlFor="event-channel" error={errors.channelId}>
            {voice.length ? (
              <select
                id="event-channel"
                value={draft.channelId}
                onChange={(e) => set('channelId', e.target.value)}
                className={selectClass}
                aria-invalid={errors.channelId ? true : undefined}
              >
                <option value="">Pick a voice channel</option>
                {voice.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[14px] text-muted">This Space has no voice channel you can see.</p>
            )}
          </Field>
        ) : (
          <Input
            id="event-location"
            label="Enter a location"
            placeholder="Add a location, link or something."
            value={draft.location}
            maxLength={EVENT_LOCATION_MAX_LENGTH}
            onChange={(e) => set('location', e.target.value)}
            error={errors.location}
          />
        )}
      </div>
    );
  } else if (step === 1) {
    body = (
      <div className="flex flex-col gap-4">
        <Input
          id="event-name"
          label="Event Topic"
          placeholder="What’s your event?"
          value={draft.name}
          maxLength={EVENT_NAME_MAX_LENGTH}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />
        <DateTimeRow
          idPrefix="event-start"
          label="Start"
          date={draft.startDate}
          time={draft.startTime}
          onDate={(v) => set('startDate', v)}
          onTime={(v) => set('startTime', v)}
          error={errors.startAt}
          disabled={live}
        />
        <DateTimeRow
          idPrefix="event-end"
          label="End"
          date={draft.endDate}
          time={draft.endTime}
          onDate={(v) => set('endDate', v)}
          onTime={(v) => set('endTime', v)}
          error={errors.endAt}
          optional={draft.entityType === 'voice'}
        />
        <Textarea
          id="event-description"
          label="Description"
          placeholder="Tell people a little more about your event."
          rows={3}
          value={draft.description}
          maxLength={EVENT_DESCRIPTION_MAX_LENGTH}
          onChange={(e) => set('description', e.target.value)}
          aside={`${draft.description.length}/${EVENT_DESCRIPTION_MAX_LENGTH}`}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-fg">Cover Image</span>
          {coverUrl ? (
            <div className="aspect-[5/2] w-full max-w-md overflow-hidden rounded-xl bg-surface-2">
              <img src={mediaUrl(coverUrl)} alt="Cover preview" className="size-full object-cover" />
            </div>
          ) : (
            <p className="text-[13px] text-muted">We recommend an image of at least 800×320.</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="soft" leftIcon={ImageUp} onClick={() => coverInput.current?.click()}>
              {coverUrl ? 'Change Image' : 'Upload Cover Image'}
            </Button>
            {coverUrl ? (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={Trash2}
                onClick={() => setDraft((d) => ({ ...d, image: null, removeImage: true }))}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <input
            ref={coverInput}
            type="file"
            accept={[...BANNER_MIME_TYPES].join(',')}
            className="hidden"
            aria-hidden
            tabIndex={-1}
            data-testid="event-cover-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) setCoverFile(f);
            }}
          />
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-[14px] text-muted">Here’s a preview of your event.</p>
        <EventCard event={preview} space={space} preview />
        {preview.status === 'scheduled' ? (
          <p className="text-[13px] text-muted">
            {draft.entityType === 'external'
              ? 'This event starts and ends on its own at the times you set.'
              : 'You can start this event from 15 minutes before its start time.'}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={event ? 'Edit Event' : step === 0 ? 'Where is your event?' : step === 1 ? 'What’s your event about?' : 'Review your event'}
      size="lg"
      footer={
        <>
          {step === 0 ? (
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as WizardStep)} disabled={busy}>
              Back
            </Button>
          )}
          {step < 2 ? (
            <Button onClick={next}>Next</Button>
          ) : (
            <Button onClick={() => void submit()} loading={busy}>
              {event ? 'Save Event' : 'Create Event'}
            </Button>
          )}
        </>
      }
    >
      <Steps step={step} />
      {body}
      <BannerCropDialog
        file={coverFile}
        onClose={() => setCoverFile(null)}
        successToast={null}
        onUploaded={(m) => setDraft((d) => ({ ...d, image: { id: m.id, url: m.url }, removeImage: false }))}
      />
    </Modal>
  );
}
