import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { REDUCED_MOTION_QUERY, useMediaQuery, useReducedMotion } from './useMediaQuery';

describe('useMediaQuery', () => {
  afterEach(() => vi.restoreAllMocks());

  it('subscribes once per query, not once per render', () => {
    const add = vi.fn();
    const remove = vi.fn();
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: add,
          removeEventListener: remove,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    const { result, rerender, unmount } = renderHook(() => useMediaQuery('(min-width: 1px)'));
    for (let i = 0; i < 10; i++) rerender();
    expect(result.current).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(matchMedia).toHaveBeenCalledTimes(1);
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('useReducedMotion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useUi.setState({ prefs: DEFAULT_PREFS });
  });

  it('follows the OS under "system", and the pref overrides it either way', () => {
    // The hook keeps one MediaQueryList per query, so `matches` is a live getter.
    let osReduce = true;
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          get matches() {
            return query === REDUCED_MOTION_QUERY && osReduce;
          },
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
    act(() => useUi.getState().setPref('reduceMotion', 'off'));
    expect(result.current).toBe(false);
    act(() => useUi.getState().setPref('reduceMotion', 'on'));
    expect(result.current).toBe(true);
    osReduce = false;
    act(() => useUi.getState().setPref('reduceMotion', 'system'));
    expect(result.current).toBe(false);
    act(() => useUi.getState().setPref('reduceMotion', 'on'));
    expect(result.current).toBe(true);
  });
});
