import { describe, expect, it } from 'vitest';
import { STATUS_BACKGROUND_COLORS } from '@enbox/shared';
import {
  PHOTO_TEXT_DURATION_MS,
  firstUnviewedIndex,
  moveViewer,
  nextColor,
  ringSegments,
  statusDuration,
  textStatusSize,
} from './logic';

describe('status viewer navigation', () => {
  const pos = { userIndex: 1, index: 0, count: 3, queueLength: 3 };

  it('moves within a user, then to the next user, then closes', () => {
    expect(moveViewer(1, pos)).toEqual({ kind: 'status', index: 1 });
    expect(moveViewer(1, { ...pos, index: 2 })).toEqual({
      kind: 'user',
      userIndex: 2,
      direction: 1,
    });
    expect(moveViewer(1, { ...pos, userIndex: 2, index: 2 })).toEqual({ kind: 'close' });
  });

  it('goes back within a user, to the previous user, or restarts the first status', () => {
    expect(moveViewer(-1, { ...pos, index: 2 })).toEqual({ kind: 'status', index: 1 });
    expect(moveViewer(-1, pos)).toEqual({ kind: 'user', userIndex: 0, direction: -1 });
    expect(moveViewer(-1, { ...pos, userIndex: 0 })).toEqual({ kind: 'status', index: 0 });
  });

  it('starts at the first unseen status', () => {
    expect(firstUnviewedIndex([{ viewed: true }, { viewed: false }, { viewed: false }])).toBe(1);
    expect(firstUnviewedIndex([{ viewed: true }, { viewed: true }])).toBe(0);
  });

  it('durations: 5 s for text/photo, the video length (capped) for videos', () => {
    expect(statusDuration({ type: 'text', media: null })).toBe(PHOTO_TEXT_DURATION_MS);
    expect(statusDuration({ type: 'video', media: { durationMs: 12_000 } as never })).toBe(12_000);
    expect(statusDuration({ type: 'video', media: { durationMs: 600_000 } as never })).toBe(61_000);
  });
});

describe('status composer helpers', () => {
  it('cycles background colors', () => {
    expect(nextColor(STATUS_BACKGROUND_COLORS[0])).toBe(STATUS_BACKGROUND_COLORS[1]);
    expect(nextColor(STATUS_BACKGROUND_COLORS.at(-1)!)).toBe(STATUS_BACKGROUND_COLORS[0]);
  });

  it('shrinks the font for long texts', () => {
    expect(textStatusSize('hi')).toBeGreaterThan(textStatusSize('x'.repeat(200)));
    expect(textStatusSize('x'.repeat(200))).toBeGreaterThan(textStatusSize('x'.repeat(700)));
  });

  it('ring segments cover the circle with gaps', () => {
    const one = ringSegments(1, 52, 2.5);
    expect(one).toHaveLength(1);
    const four = ringSegments(4, 52, 2.5);
    expect(four).toHaveLength(4);
    const c = 2 * Math.PI * four[0]!.r;
    const seg = Number(four[0]!.dasharray.split(' ')[0]);
    expect(seg).toBeCloseTo(c / 4 - 3, 5);
    expect(four[1]!.dashoffset).toBeCloseTo(-(c / 4) - 1.5, 5);
  });
});
