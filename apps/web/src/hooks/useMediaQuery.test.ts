import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

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
