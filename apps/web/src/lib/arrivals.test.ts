import { beforeEach, describe, expect, it } from 'vitest';
import {
  ARRIVAL_WINDOW_MS,
  arrivalKey,
  clearArrivals,
  isFreshArrival,
  markArrival,
} from './arrivals';

describe('arrivals', () => {
  beforeEach(() => clearArrivals());

  it('is fresh inside the window and stale after it', () => {
    markArrival('a', 1000);
    expect(isFreshArrival('a', 1000 + ARRIVAL_WINDOW_MS)).toBe(true);
    expect(isFreshArrival('a', 1000 + ARRIVAL_WINDOW_MS + 1)).toBe(false);
    expect(isFreshArrival('never')).toBe(false);
  });

  it('keys optimistic and confirmed copies of a message the same way', () => {
    expect(arrivalKey({ id: 'server-id', clientId: 'c1' })).toBe('c:c1');
    expect(arrivalKey({ id: 'server-id', clientId: null })).toBe('server-id');
  });

  it('is bounded and cleared by a window replacement', () => {
    for (let i = 0; i < 200; i++) markArrival(`k${i}`, 5000);
    expect(isFreshArrival('k0', 5000)).toBe(false);
    expect(isFreshArrival('k199', 5000)).toBe(true);
    clearArrivals();
    expect(isFreshArrival('k199', 5000)).toBe(false);
  });
});
