import { describe, expect, it } from 'vitest';
import type { Call, CallLogEntry, CallParticipant } from '@enbox/shared';
import {
  callKindLabel,
  countMissedSince,
  derivePhase,
  endReasonText,
  gridColumns,
  groupCallLog,
  hasPoorConnection,
  logEntryFor,
} from './logic';
import { SpeakingTracker } from './engine/speaking';

const ME = 'me';
const P = 'peer';
const Q = 'q';

function part(
  userId: string,
  status: CallParticipant['status'],
  p: Partial<CallParticipant> = {},
): CallParticipant {
  return {
    userId,
    status,
    joinedAt: null,
    leftAt: null,
    audioMuted: false,
    videoOff: true,
    screenSharing: false,
    ...p,
  };
}

function call(p: Partial<Call> = {}): Call {
  return {
    id: 'c1',
    chatId: 'chat1',
    type: 'audio',
    isGroup: false,
    initiatorId: ME,
    status: 'ringing',
    createdAt: '2025-06-01T10:00:00.000Z',
    answeredAt: null,
    endedAt: null,
    durationSec: null,
    participants: [part(ME, 'joined'), part(P, 'invited')],
    ...p,
  };
}

describe('derivePhase', () => {
  it('outgoing: calling → ringing → connecting → connected', () => {
    expect(derivePhase({ call: call(), selfId: ME, connections: {} })).toBe('calling');
    expect(
      derivePhase({
        call: call({ participants: [part(ME, 'joined'), part(P, 'ringing')] }),
        selfId: ME,
        connections: {},
      }),
    ).toBe('ringing');
    const answered = call({
      status: 'ongoing',
      participants: [part(ME, 'joined'), part(P, 'joined')],
    });
    expect(derivePhase({ call: answered, selfId: ME, connections: { [P]: 'connecting' } })).toBe(
      'connecting',
    );
    expect(derivePhase({ call: answered, selfId: ME, connections: { [P]: 'connected' } })).toBe(
      'connected',
    );
  });

  it('starting / reconnecting / ended take precedence', () => {
    expect(derivePhase({ call: call(), selfId: ME, connections: {}, starting: true })).toBe(
      'starting',
    );
    const answered = call({
      status: 'ongoing',
      participants: [part(ME, 'joined'), part(P, 'joined')],
    });
    expect(
      derivePhase({
        call: answered,
        selfId: ME,
        connections: { [P]: 'connected' },
        reconnecting: true,
      }),
    ).toBe('reconnecting');
    expect(
      derivePhase({
        call: call({ status: 'ended' }),
        selfId: ME,
        connections: {},
        reconnecting: true,
      }),
    ).toBe('ended');
  });

  it('group: connected as soon as one peer is connected', () => {
    const c = call({
      isGroup: true,
      status: 'ongoing',
      participants: [part(ME, 'joined'), part(P, 'joined'), part(Q, 'ringing')],
    });
    expect(derivePhase({ call: c, selfId: ME, connections: { [P]: 'connected' } })).toBe(
      'connected',
    );
    const alone = call({
      isGroup: true,
      status: 'ongoing',
      participants: [part(ME, 'joined'), part(P, 'left'), part(Q, 'invited')],
    });
    expect(derivePhase({ call: alone, selfId: ME, connections: {} })).toBe('calling');
  });
});

describe('endReasonText', () => {
  it('outgoing reasons', () => {
    expect(endReasonText(call({ status: 'declined' }), ME)).toBe('Declined');
    expect(endReasonText(call({ status: 'missed' }), ME)).toBe('No answer');
    expect(
      endReasonText(
        call({ status: 'missed', participants: [part(ME, 'left'), part(P, 'busy')] }),
        ME,
      ),
    ).toBe('Busy');
    expect(endReasonText(call({ status: 'cancelled' }), ME)).toBe('Call cancelled');
    expect(endReasonText(call({ status: 'ended' }), ME)).toBe('Call ended');
  });
  it('incoming reasons', () => {
    expect(endReasonText(call({ status: 'cancelled' }), P)).toBe('Missed call');
    expect(endReasonText(call({ status: 'missed' }), P)).toBe('Missed call');
    expect(endReasonText(call({ status: 'ended' }), P)).toBe('Call ended');
  });
});

function entry(
  id: string,
  p: Partial<CallLogEntry> & { createdAt?: string; chatId?: string } = {},
): CallLogEntry {
  return {
    call: call({
      id,
      createdAt: p.createdAt ?? '2025-06-01T10:00:00.000Z',
      chatId: p.chatId ?? 'chat1',
      status: 'ended',
    }),
    direction: p.direction ?? 'incoming',
    outcome: p.outcome ?? 'answered',
    chat: { id: p.chatId ?? 'chat1', type: 'direct', name: null, avatarUrl: null, peer: null },
  };
}

describe('call log', () => {
  it('groups consecutive calls of the same chat, direction and missed-ness on the same day', () => {
    const list = [
      entry('1', { outcome: 'missed', createdAt: '2025-06-01T12:00:00.000Z' }),
      entry('2', { outcome: 'missed', createdAt: '2025-06-01T11:00:00.000Z' }),
      entry('3', { outcome: 'answered', createdAt: '2025-06-01T10:30:00.000Z' }),
      entry('4', { outcome: 'answered', chatId: 'other', createdAt: '2025-06-01T10:00:00.000Z' }),
      entry('5', { outcome: 'answered', chatId: 'other', createdAt: '2025-05-20T10:00:00.000Z' }),
    ];
    const groups = groupCallLog(list);
    expect(groups.map((g) => g.entries.map((e) => e.call.id))).toEqual([
      ['1', '2'],
      ['3'],
      ['4'],
      ['5'],
    ]);
    expect(groupCallLog(list, 'missed').map((g) => g.key)).toEqual(['1']);
  });

  it('counts missed incoming calls after the last visit', () => {
    const list = [
      entry('1', { outcome: 'missed', createdAt: '2025-06-01T12:00:00.000Z' }),
      entry('2', { outcome: 'missed', createdAt: '2025-06-01T08:00:00.000Z' }),
      entry('3', {
        outcome: 'unanswered',
        direction: 'outgoing',
        createdAt: '2025-06-01T12:30:00.000Z',
      }),
    ];
    expect(countMissedSince(list, Date.parse('2025-06-01T09:00:00.000Z'))).toBe(1);
    expect(countMissedSince(list, 0)).toBe(2);
  });

  it('builds a log entry from my participant status', () => {
    const c = call({
      status: 'missed',
      initiatorId: P,
      participants: [part(P, 'left'), part(ME, 'missed')],
    });
    expect(
      logEntryFor(c, ME, { id: 'chat1', type: 'direct', name: null, avatarUrl: null, peer: null }),
    ).toMatchObject({
      direction: 'incoming',
      outcome: 'missed',
    });
  });
});

describe('misc', () => {
  it('labels and grid', () => {
    expect(callKindLabel({ type: 'video', isGroup: true })).toBe('Group video call');
    expect(callKindLabel({ type: 'audio', isGroup: false })).toBe('Voice call');
    expect([1, 2, 3, 4, 5, 8].map((n) => gridColumns(n, false))).toEqual([1, 1, 2, 2, 2, 2]);
    expect([1, 2, 3, 5, 8].map((n) => gridColumns(n, true))).toEqual([1, 2, 2, 3, 4]);
    expect(hasPoorConnection({ a: 'connected', b: 'disconnected' }, ['a', 'b'])).toBe(true);
    expect(hasPoorConnection({ a: 'connected' }, ['a'])).toBe(false);
  });
});

describe('SpeakingTracker', () => {
  it('debounces speaking and holds the active speaker', () => {
    const t = new SpeakingTracker(0.02, 500, 1000);
    const s1 = t.update(
      new Map([
        ['a', 0.1],
        ['b', 0],
      ]),
      0,
      'me',
    );
    expect(s1).toEqual({ speaking: ['a'], activeSpeakerId: 'a' });
    // b gets louder but a is still talking and held for < 1s → a stays active.
    const s2 = t.update(
      new Map([
        ['a', 0.05],
        ['b', 0.2],
      ]),
      400,
      'me',
    );
    expect(s2.speaking).toEqual(['a', 'b']);
    expect(s2.activeSpeakerId).toBe('a');
    const s3 = t.update(
      new Map([
        ['a', 0.05],
        ['b', 0.2],
      ]),
      1200,
      'me',
    );
    expect(s3.activeSpeakerId).toBe('b');
    // Silence: still "speaking" within the hold window, then not.
    expect(
      t.update(
        new Map([
          ['a', 0],
          ['b', 0],
        ]),
        1500,
        'me',
      ).speaking,
    ).toEqual(['a', 'b']);
    expect(
      t.update(
        new Map([
          ['a', 0],
          ['b', 0],
        ]),
        2000,
        'me',
      ).speaking,
    ).toEqual([]);
  });

  it('never makes me the active speaker and forgets removed ids', () => {
    const t = new SpeakingTracker(0.02, 500, 1000);
    expect(t.update(new Map([['me', 0.5]]), 0, 'me')).toEqual({
      speaking: ['me'],
      activeSpeakerId: null,
    });
    t.update(new Map([['a', 0.5]]), 100, 'me');
    expect(t.update(new Map(), 200, 'me')).toEqual({ speaking: [], activeSpeakerId: null });
  });
});
