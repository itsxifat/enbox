import { afterEach, describe, expect, it } from 'vitest';
import {
  canGoBack,
  canGoForward,
  historyKey,
  recordNavigation,
  stepTrail,
  useNavHistory,
  type HistoryTrail,
} from './history';

const trail = (keys: string[], pos: number, base = 0): HistoryTrail => ({ keys, pos, base });

describe('the history trail', () => {
  afterEach(() => {
    useNavHistory.setState({ trail: null });
    sessionStorage.clear();
  });

  it('starts at the first entry: nowhere to go', () => {
    const t = stepTrail(null, 'POP', 'a', 0);
    expect(t).toEqual(trail(['a'], 0));
    expect(canGoBack(t)).toBe(false);
    expect(canGoForward(t)).toBe(false);
  });

  it('a push drops what was ahead; back and forward move along it', () => {
    let t = stepTrail(null, 'POP', 'a', 0);
    t = stepTrail(t, 'PUSH', 'b', 1);
    t = stepTrail(t, 'PUSH', 'c', 2);
    expect(t).toEqual(trail(['a', 'b', 'c'], 2));
    t = stepTrail(t, 'POP', 'b', 1);
    expect([canGoBack(t), canGoForward(t)]).toEqual([true, true]);
    t = stepTrail(t, 'PUSH', 'd', 2);
    expect(t).toEqual(trail(['a', 'b', 'd'], 2));
    expect(canGoForward(t)).toBe(false);
  });

  it('a replace swaps the current entry; the same entry again changes nothing', () => {
    const t = stepTrail(trail(['a', 'b'], 1), 'REPLACE', 'b2', 1);
    expect(t).toEqual(trail(['a', 'b2'], 1));
    expect(stepTrail(t, 'POP', 'b2', 1)).toBe(t);
  });

  it('entries before the first one seen still count for Back (a reload deep in the history)', () => {
    let t = stepTrail(null, 'POP', 'x', 4);
    expect(canGoBack(t)).toBe(true);
    // Back to the entry right before: the trail grows at the front, Forward stays possible.
    t = stepTrail(t, 'POP', 'w', 3);
    expect(t).toEqual(trail(['w', 'x'], 0, 3));
    expect([canGoBack(t), canGoForward(t)]).toEqual([true, true]);
    // Somewhere it never saw: a new trail there.
    expect(stepTrail(t, 'POP', 'q', 0)).toEqual(trail(['q'], 0, 0));
  });

  it('keeps at most 200 entries, folding the oldest into the base', () => {
    let t = stepTrail(null, 'POP', 'k0', 0);
    for (let i = 1; i <= 205; i++) t = stepTrail(t, 'PUSH', `k${i}`, i);
    expect(t.keys).toHaveLength(200);
    expect(t.base + t.pos).toBe(205);
    expect(t.keys[0]).toBe('k6');
  });

  it('survives a reload through sessionStorage, but not on a fresh page', () => {
    recordNavigation('POP', 'a');
    recordNavigation('PUSH', 'b');
    recordNavigation('POP', 'a');
    useNavHistory.setState({ trail: null });
    recordNavigation('POP', 'a');
    expect(canGoForward(useNavHistory.getState().trail)).toBe(true);

    useNavHistory.setState({ trail: null });
    recordNavigation('POP', 'default');
    expect(useNavHistory.getState().trail).toEqual(trail(['default'], 0));
  });
});

describe('historyKey', () => {
  const key = (k: Partial<KeyboardEvent>) => ({ key: '', code: '', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...k });

  it('Alt+← / Alt+→ elsewhere', () => {
    expect(historyKey(key({ key: 'ArrowLeft', altKey: true }), false)).toBe(-1);
    expect(historyKey(key({ key: 'ArrowRight', altKey: true }), false)).toBe(1);
    expect(historyKey(key({ key: 'ArrowLeft' }), false)).toBeNull();
    expect(historyKey(key({ key: 'ArrowLeft', altKey: true, shiftKey: true }), false)).toBeNull();
    expect(historyKey(key({ key: 'ArrowUp', altKey: true }), false)).toBeNull();
  });

  it('⌘[ / ⌘] on macOS (by code too, for other layouts), not Option+arrows', () => {
    expect(historyKey(key({ key: '[', metaKey: true }), true)).toBe(-1);
    expect(historyKey(key({ key: 'ü', code: 'BracketRight', metaKey: true }), true)).toBe(1);
    expect(historyKey(key({ key: 'ArrowLeft', altKey: true }), true)).toBeNull();
    expect(historyKey(key({ key: '[', metaKey: true, ctrlKey: true }), true)).toBeNull();
  });
});
