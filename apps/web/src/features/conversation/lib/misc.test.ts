import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TYPING_REFRESH_MS, WAVEFORM_MAX_SAMPLES, type Poll } from '@enbox/shared';
import { makeMessage } from '@/test/factories';
import { applyReaction, applyVote, myReactionOf, nextVoteSelection } from './optimistic';
import { pickRecorderMime } from './recorder';
import { TYPING_IDLE_AFTER_MS, createTypingEmitter } from './typing';
import { downsampleWaveform, fallbackWaveform, resampleWaveform } from './waveform';

describe('typing emitter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends typing at most every TYPING_REFRESH_MS and idle after a pause', () => {
    const send = vi.fn((_p: { chatId: string; state: string }) => true);
    const t = createTypingEmitter('chat-1', send);
    t.keystroke();
    t.keystroke();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith({ chatId: 'chat-1', state: 'typing' });
    vi.advanceTimersByTime(TYPING_REFRESH_MS);
    t.keystroke();
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(TYPING_IDLE_AFTER_MS);
    expect(send).toHaveBeenLastCalledWith({ chatId: 'chat-1', state: 'idle' });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('refreshes recording and stops with idle; stop() is a no-op when idle', () => {
    const send = vi.fn((_p: { chatId: string; state: string }) => true);
    const t = createTypingEmitter('c', send);
    t.stop();
    expect(send).not.toHaveBeenCalled();
    t.recording(true);
    vi.advanceTimersByTime(TYPING_REFRESH_MS * 2);
    expect(send.mock.calls.filter(([p]) => p.state === 'recording')).toHaveLength(3);
    t.keystroke(); // ignored while recording
    t.recording(false);
    expect(send).toHaveBeenLastCalledWith({ chatId: 'c', state: 'idle' });
    const n = send.mock.calls.length;
    vi.advanceTimersByTime(TYPING_REFRESH_MS * 3);
    expect(send).toHaveBeenCalledTimes(n);
  });
});

describe('waveforms', () => {
  it('downsamples to ≤ WAVEFORM_MAX_SAMPLES normalised peaks', () => {
    const raw = Array.from({ length: 1000 }, (_, i) => (i % 100) / 400);
    const w = downsampleWaveform(raw);
    expect(w).toHaveLength(WAVEFORM_MAX_SAMPLES);
    expect(Math.max(...w)).toBe(1);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(0.06);
    expect(downsampleWaveform([])).toEqual([]);
    expect(downsampleWaveform([0, 0, 0])).toEqual([0.06, 0.06, 0.06]);
  });

  it('resamples for display and has a deterministic fallback', () => {
    expect(resampleWaveform([0, 1], 3)).toEqual([0, 0.5, 1]);
    expect(fallbackWaveform('m1', 10)).toEqual(fallbackWaveform('m1', 10));
    expect(fallbackWaveform('m1', 10)).toHaveLength(10);
  });
});

describe('recorder mime selection', () => {
  it('prefers Opus in WebM, falls back to MP4 (Safari)', () => {
    expect(pickRecorderMime(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickRecorderMime((t) => t.startsWith('audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(pickRecorderMime(() => false)).toBeUndefined();
  });
});

describe('optimistic reactions', () => {
  const base = makeMessage({
    reactions: [
      { emoji: '👍', count: 2, userIds: ['me', 'bob'] },
      { emoji: '❤️', count: 1, userIds: ['bob2'] },
    ],
  });

  it('replaces my previous reaction', () => {
    const m = applyReaction(base, '❤️', 'me');
    expect(m.myReaction).toBe('❤️');
    expect(m.reactions).toEqual([
      { emoji: '👍', count: 1, userIds: ['bob'] },
      { emoji: '❤️', count: 2, userIds: ['bob2', 'me'] },
    ]);
  });

  it('removes and adds new emoji; anonymous chats keep userIds empty', () => {
    const removed = applyReaction({ ...base, myReaction: '👍' }, null, 'me');
    expect(removed.reactions[0]).toEqual({ emoji: '👍', count: 1, userIds: ['bob'] });
    expect(myReactionOf(removed, 'me')).toBeNull();
    const anon = applyReaction({ reactions: [], myReaction: null }, '🎉', 'me', true);
    expect(anon.reactions).toEqual([{ emoji: '🎉', count: 1, userIds: [] }]);
  });
});

describe('optimistic poll votes', () => {
  const poll: Poll = {
    question: 'Q',
    allowMultiple: false,
    totalVoters: 1,
    options: [
      { id: 'a', text: 'A', voteCount: 1, voterIds: ['bob'] },
      { id: 'b', text: 'B', voteCount: 0, voterIds: [] },
    ],
  };

  it('single choice: select, switch, retract', () => {
    expect(nextVoteSelection(poll, 'a', 'me')).toEqual(['a']);
    const voted = applyVote(poll, ['a'], 'me');
    expect(voted.totalVoters).toBe(2);
    expect(voted.options[0]).toMatchObject({ voteCount: 2, voterIds: ['bob', 'me'] });
    expect(nextVoteSelection(voted, 'a', 'me')).toEqual([]);
    const switched = applyVote(voted, ['b'], 'me');
    expect(switched.options.map((o) => o.voteCount)).toEqual([1, 1]);
    expect(switched.totalVoters).toBe(2);
    const retracted = applyVote(switched, [], 'me');
    expect(retracted.totalVoters).toBe(1);
    expect(retracted.myOptionIds).toEqual([]);
  });

  it('multiple choice toggles options', () => {
    const multi = { ...poll, allowMultiple: true, myOptionIds: ['a'] };
    expect(nextVoteSelection(multi, 'b', 'me')).toEqual(['a', 'b']);
    expect(nextVoteSelection(multi, 'a', 'me')).toEqual([]);
  });
});
