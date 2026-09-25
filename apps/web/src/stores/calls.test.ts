import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Call, CallLogEntry } from '@enbox/shared';
import { api } from '@/lib/api';
import { CALL_LOG_PAGE, mergeLog, useCalls } from './calls';

function call(id: string, p: Partial<Call> = {}): Call {
  return {
    id,
    chatId: `chat-${id}`,
    type: 'audio',
    isGroup: true,
    initiatorId: 'u1',
    status: 'ongoing',
    createdAt: `2025-06-01T10:00:0${id.length % 10}.000Z`,
    answeredAt: null,
    endedAt: null,
    durationSec: null,
    participants: [],
    ...p,
  };
}

function entry(id: string, createdAt: string): CallLogEntry {
  return {
    call: call(id, { createdAt, status: 'ended' }),
    direction: 'incoming',
    outcome: 'answered',
    chat: { id: `chat-${id}`, type: 'direct', name: null, avatarUrl: null, peer: null },
  };
}

const initial = useCalls.getState();
beforeEach(() => {
  useCalls.setState(initial, true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('calls store: live calls', () => {
  it('tracks live calls per chat and drops terminal ones', () => {
    const s = useCalls.getState();
    s.setLiveCall(call('a'));
    expect(useCalls.getState().liveCalls['chat-a']?.id).toBe('a');
    s.setLiveCall(call('a', { status: 'ended' }));
    expect(useCalls.getState().liveCalls['chat-a']).toBeUndefined();
  });

  it('removeLiveCall only removes the matching call id', () => {
    const s = useCalls.getState();
    s.setLiveCall(call('a'));
    s.removeLiveCall('chat-a', 'other');
    expect(useCalls.getState().liveCalls['chat-a']).toBeDefined();
    s.removeLiveCall('chat-a', 'a');
    expect(useCalls.getState().liveCalls['chat-a']).toBeUndefined();
  });

  it('setLiveCalls replaces the map (live only)', () => {
    useCalls
      .getState()
      .setLiveCalls([
        call('a'),
        call('bb', { status: 'missed' }),
        call('ccc', { status: 'ringing' }),
      ]);
    expect(Object.keys(useCalls.getState().liveCalls).sort()).toEqual(['chat-a', 'chat-ccc']);
  });

  it('declineIncoming clears the ring locally', () => {
    useCalls.setState({
      incoming: {
        call: call('x', { status: 'ringing' }),
        chat: {
          id: 'chat-x',
          type: 'direct',
          name: null,
          avatarUrl: null,
          peer: null,
          memberCount: 2,
        },
        caller: {} as never,
        silent: false,
      },
    });
    useCalls.getState().declineIncoming();
    expect(useCalls.getState().incoming).toBeNull();
  });
});

describe('calls store: log', () => {
  it('mergeLog dedupes by id and sorts newest first', () => {
    const merged = mergeLog(
      [entry('a', '2025-06-01T10:00:00.000Z'), entry('b', '2025-06-01T09:00:00.000Z')],
      [entry('c', '2025-06-01T11:00:00.000Z'), entry('a', '2025-06-01T10:00:00.000Z')],
    );
    expect(merged.map((e) => e.call.id)).toEqual(['c', 'a', 'b']);
  });

  it('loads the first page, pages with `before`, and refresh keeps older pages', async () => {
    const page1 = Array.from({ length: CALL_LOG_PAGE }, (_, i) =>
      entry(`p1-${i}`, new Date(Date.UTC(2025, 5, 2, 0, 0, 0) - i * 60_000).toISOString()),
    );
    const page2 = [entry('old', '2025-05-01T00:00:00.000Z')];
    const get = vi.spyOn(api, 'get').mockImplementation(async (_path, opts) => {
      const before = opts?.query?.before;
      return (before ? page2 : page1) as never;
    });
    await useCalls.getState().loadLog();
    expect(useCalls.getState().log.entries).toHaveLength(CALL_LOG_PAGE);
    expect(useCalls.getState().log.hasMore).toBe(true);
    await useCalls.getState().loadMoreLog();
    expect(get).toHaveBeenLastCalledWith('/api/calls', {
      query: { limit: CALL_LOG_PAGE, before: page1.at(-1)!.call.createdAt },
    });
    expect(useCalls.getState().log.entries.at(-1)?.call.id).toBe('old');
    expect(useCalls.getState().log.hasMore).toBe(false);
    await useCalls.getState().loadLog({ refresh: true });
    expect(useCalls.getState().log.entries.at(-1)?.call.id).toBe('old');
  });

  it('removeLogEntry is optimistic and restores on failure', async () => {
    useCalls.setState({
      log: {
        ...useCalls.getState().log,
        loaded: true,
        entries: [entry('a', '2025-06-01T10:00:00.000Z')],
      },
    });
    vi.spyOn(api, 'delete').mockRejectedValueOnce(new Error('nope'));
    await expect(useCalls.getState().removeLogEntry('a')).rejects.toThrow('nope');
    expect(useCalls.getState().log.entries.map((e) => e.call.id)).toEqual(['a']);
    vi.spyOn(api, 'delete').mockResolvedValueOnce(undefined as never);
    await useCalls.getState().removeLogEntry('a');
    expect(useCalls.getState().log.entries).toEqual([]);
  });
});
