/** The create / edit wizard: its 3 steps, the validation of each, the request it sends, server field errors. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PERM } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { ApiError, api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useEvents } from '@/stores/events';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import {
  CreateEventWizard,
  changesOf,
  draftErrors,
  draftOf,
  requestOf,
  type EventDraft,
} from './CreateEventWizard';
import { defaultEventStart, fromInputs, toDateInput, toTimeInput } from './format';
import { makeEvent, makeVoiceChannel } from './testUtils';

const NOW = new Date(2026, 9, 23, 18, 20); // Fri, Oct 23 2026, 6:20 PM local
const space = makeSpace({ id: 's1', name: 'Lab', myPermissions: PERM.MANAGE_CHANNELS });
const voice = makeVoiceChannel();
const inputs = (d: Date) => ({ date: toDateInput(d), time: toTimeInput(d) });

function draft(p: Partial<EventDraft> = {}): EventDraft {
  return { ...draftOf(undefined, [voice], NOW), name: 'Movie night', ...p };
}

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
  useSpaces.setState({ byId: { s1: space }, order: ['s1'] });
  useChats.setState({ byId: { [voice.id]: voice } });
  useEvents.setState({ bySpace: { s1: [] } });
  vi.spyOn(api, 'post').mockResolvedValue([] as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  useChats.setState({ byId: {} });
});

describe('draft rules', () => {
  it('a new draft: voice in the first voice channel, starting at the next full hour', () => {
    const d = draftOf(undefined, [voice], NOW);
    expect(d).toMatchObject({ entityType: 'voice', channelId: 'v1', endDate: '', endTime: '' });
    expect(fromInputs(d.startDate, d.startTime)).toEqual(new Date(2026, 9, 23, 19, 0));
    expect(defaultEventStart(new Date(2026, 9, 23, 23, 30))).toEqual(new Date(2026, 9, 24, 0, 0));
    // No voice channel: somewhere else.
    expect(draftOf(undefined, [], NOW).entityType).toBe('external');
  });

  it('step 1: a voice channel, or a location', () => {
    expect(draftErrors(0, draft())).toEqual({});
    expect(draftErrors(0, draft({ channelId: '' }))).toEqual({ channelId: 'Pick a voice channel' });
    expect(draftErrors(0, draft({ entityType: 'external', location: '  ' }))).toEqual({ location: 'Enter a location' });
  });

  it('step 2: a topic, a start in the future within a year, an end after it (required somewhere else)', () => {
    const now = NOW.getTime();
    expect(draftErrors(1, draft(), { now })).toEqual({});
    expect(draftErrors(1, draft({ name: ' ' }), { now }).name).toBe('Give your event a topic');
    const past = inputs(new Date(2026, 9, 23, 17, 0));
    expect(draftErrors(1, draft({ startDate: past.date, startTime: past.time }), { now }).startAt).toBe(
      'The start time must be in the future',
    );
    const far = inputs(new Date(2027, 11, 1, 10, 0));
    expect(draftErrors(1, draft({ startDate: far.date, startTime: far.time }), { now }).startAt).toMatch(/a year ahead/);
    expect(draftErrors(1, draft({ startTime: '' }), { now }).startAt).toBe('Pick a start date and time');
    expect(draftErrors(1, draft({ entityType: 'external', location: 'Park' }), { now }).endAt).toBe(
      'Events somewhere else need an end time',
    );
    const before = inputs(new Date(2026, 9, 23, 18, 30));
    expect(draftErrors(1, draft({ endDate: before.date, endTime: before.time }), { now }).endAt).toBe(
      'The end time must be after the start time',
    );
    expect(draftErrors(1, draft({ endDate: '2026-10-23' }), { now }).endAt).toBe('Pick an end date and time');
    // Editing: an unchanged start in the past is fine (a live event's cannot change).
    const live = makeEvent({ status: 'active', startAt: new Date(2026, 9, 23, 17, 0).toISOString() });
    const d = draftOf(live, [voice]);
    expect(draftErrors(1, d, { now, event: live })).toEqual({});
  });

  it('the requests: create sends the whole event; edit only what changed', () => {
    const d = draft({ description: '  Snacks  ', image: { id: 'm1', url: '/uploads/c.jpg' } });
    expect(requestOf(d)).toEqual({
      name: 'Movie night',
      description: 'Snacks',
      entityType: 'voice',
      channelId: 'v1',
      location: null,
      startAt: new Date(2026, 9, 23, 19, 0).toISOString(),
      endAt: null,
      imageMediaId: 'm1',
    });
    const ev = makeEvent({ startAt: new Date(2026, 9, 25, 19, 0).toISOString(), imageUrl: '/uploads/old.jpg' });
    const same = draftOf(ev, [voice]);
    expect(changesOf(ev, same)).toEqual({});
    expect(changesOf(ev, { ...same, name: 'Film night', removeImage: true })).toEqual({ name: 'Film night', imageMediaId: null });
    expect(changesOf(ev, { ...same, entityType: 'external', location: 'Park', endDate: same.startDate, endTime: '21:00' })).toEqual({
      entityType: 'external',
      channelId: null,
      location: 'Park',
      endAt: new Date(2026, 9, 25, 21, 0).toISOString(),
    });
  });
});

describe('CreateEventWizard', () => {
  const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

  function open(props: Partial<Parameters<typeof CreateEventWizard>[0]> = {}) {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<CreateEventWizard space={space} onClose={onClose} onSaved={onSaved} {...props} />);
    return { onClose, onSaved };
  }

  it('walks Location → Event Info → Review and creates the event', async () => {
    const created = makeEvent({ id: 'new', name: 'Launch party', interested: true });
    const post = vi.spyOn(api, 'post').mockImplementation(async (path) => (path === '/api/users/batch' ? [] : created) as never);
    const { onSaved } = open();
    expect(screen.getByRole('dialog', { name: 'Where is your event?' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Voice Channel/ })).toBeChecked();
    expect((screen.getByLabelText('Select a channel') as HTMLSelectElement).value).toBe('v1');
    next();
    expect(screen.getByRole('dialog', { name: 'What’s your event about?' })).toBeInTheDocument();
    // The topic is required.
    next();
    expect(screen.getByRole('alert')).toHaveTextContent('Give your event a topic');
    fireEvent.change(field('Event Topic'), { target: { value: 'Launch party' } });
    const start = new Date(Date.now() + 2 * 3600_000);
    fireEvent.change(field('Start date'), { target: { value: toDateInput(start) } });
    fireEvent.change(field('Start time'), { target: { value: toTimeInput(start) } });
    fireEvent.change(field('Description'), { target: { value: 'Cake!' } });
    next();
    expect(screen.getByRole('dialog', { name: 'Review your event' })).toBeInTheDocument();
    expect(screen.getByTestId('event-card')).toHaveTextContent('Launch party');
    expect(screen.getByTestId('event-card')).toHaveTextContent('Lounge');
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    const [path, body] = post.mock.calls.find(([p]) => p === '/api/spaces/s1/events')!;
    expect(path).toBe('/api/spaces/s1/events');
    expect(body).toMatchObject({ name: 'Launch party', entityType: 'voice', channelId: 'v1', description: 'Cake!', endAt: null });
    expect(useUi.getState().toasts.map((t) => t.message)).toContain('Event created');
  });

  it('somewhere else needs a location, then an end time; Back keeps what was typed', () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: /Somewhere Else/ }));
    next();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a location');
    fireEvent.change(field('Enter a location'), { target: { value: 'Central Park' } });
    next();
    fireEvent.change(field('Event Topic'), { target: { value: 'Picnic' } });
    next();
    expect(screen.getByRole('alert')).toHaveTextContent('Events somewhere else need an end time');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(field('Enter a location').value).toBe('Central Park');
  });

  it('Cancel on the first step closes', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('a server field error goes back to its step', async () => {
    vi.spyOn(api, 'post').mockImplementation(async (path) => {
      if (path === '/api/users/batch') return [] as never;
      throw new ApiError('validation_error', 'channelId: Unknown channel', 400, [
        { code: 'custom', path: ['channelId'], message: 'Unknown channel' },
      ]);
    });
    open();
    next();
    fireEvent.change(field('Event Topic'), { target: { value: 'Gone' } });
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Where is your event?' })).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Unknown channel');
  });

  it('editing sends only the changes', async () => {
    const ev = makeEvent({ creatorId: 'me', startAt: new Date(Date.now() + 5 * 3600_000).toISOString() });
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...ev, name: 'Film night' } as never);
    const { onSaved } = open({ event: ev });
    expect(screen.getByRole('dialog', { name: 'Edit Event' })).toBeInTheDocument();
    next();
    fireEvent.change(field('Event Topic'), { target: { value: 'Film night' } });
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Save Event' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/events/e1', { name: 'Film night' });
  });
});
