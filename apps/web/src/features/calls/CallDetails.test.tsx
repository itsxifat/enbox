/** Call info for a call that isn't in the loaded log pages → GET /api/calls/:callId. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { CallLogEntry } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/factories';
import { CallDetails } from './CallDetails';

const ME = '00000000-0000-4000-8000-0000000000aa';

const entry: CallLogEntry = {
  call: {
    id: 'old-call',
    chatId: 'chat-1',
    type: 'video',
    isGroup: false,
    initiatorId: ME,
    status: 'ended',
    createdAt: '2020-01-01T10:00:00.000Z',
    answeredAt: '2020-01-01T10:00:05.000Z',
    endedAt: '2020-01-01T10:01:05.000Z',
    durationSec: 60,
    participants: [],
  },
  direction: 'outgoing',
  outcome: 'answered',
  chat: { id: 'chat-1', type: 'direct', name: 'Old Friend', avatarUrl: null, peer: null },
} as unknown as CallLogEntry;

function renderAt(callId: string) {
  return render(
    <MemoryRouter initialEntries={[`/calls/${callId}`]}>
      <Routes>
        <Route path="/calls/:callId" element={<CallDetails />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: ME }), token: 't', status: 'authenticated' });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetSessionState();
});

describe('CallDetails', () => {
  it('fetches a call that is not in the loaded log (deep link / older page)', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/calls') return [] as never; // first log page doesn't have it
      if (path === '/api/calls/old-call') return entry as never;
      throw new Error(`unexpected ${path}`);
    });
    renderAt('old-call');
    expect(await screen.findByTestId('call-details')).toBeInTheDocument();
    expect(screen.getByText(/Outgoing video call/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/calls/old-call');
  });

  it('shows "Call not found" for a 404', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/calls') return [] as never;
      throw new ApiError('not_found', 'Call not found', 404);
    });
    renderAt('gone');
    expect(await screen.findByText('Call not found')).toBeInTheDocument();
  });
});
