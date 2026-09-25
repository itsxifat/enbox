/** Performance-related helpers: row keys identity, sequential media preparation. */
import { describe, expect, it } from 'vitest';
import { makeMessage } from '@/test/factories';
import { buildRows, rowKeys } from './rows';
import { prepareEach, type PreparedMedia } from './mediaProcessing';

describe('rowKeys', () => {
  it('returns the previous array while the keys are the same', () => {
    const items = [makeMessage({ id: 'a', seq: 1 }), makeMessage({ id: 'b', seq: 2 })];
    const rows = buildRows(items, { meId: 'me' });
    const keys = rowKeys(rows, []);
    expect(keys).toEqual(['a', 'b']);
    // Only contents changed (upload progress, reaction): same identity.
    const edited = buildRows([items[0]!, { ...items[1]!, text: 'edited' }], { meId: 'me' });
    expect(rowKeys(edited, keys)).toBe(keys);
    const more = buildRows([...items, makeMessage({ id: 'c', seq: 3 })], { meId: 'me' });
    expect(rowKeys(more, keys)).toEqual(['a', 'b', 'c']);
  });

  it('day separators and grouping still follow local days and the 5 min window', () => {
    const rows = buildRows(
      [
        makeMessage({ id: 'a', seq: 1, createdAt: '2025-03-12T10:00:00.000Z' }),
        makeMessage({ id: 'b', seq: 2, createdAt: '2025-03-12T10:04:00.000Z' }),
        makeMessage({ id: 'c', seq: 3, createdAt: '2025-03-12T10:10:00.000Z' }),
        makeMessage({ id: 'd', seq: 4, createdAt: '2025-03-15T10:10:00.000Z' }),
      ],
      { meId: 'me' },
    );
    expect(rows.map((r) => [r.showDay, r.firstInGroup])).toEqual([
      [true, true],
      [false, false],
      [false, true],
      [true, true],
    ]);
  });
});

describe('prepareEach', () => {
  it('processes one file at a time, in order, and reports failures', async () => {
    let running = 0;
    let maxRunning = 0;
    const prepare = async (file: File): Promise<PreparedMedia> => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (file.name === 'bad.jpg') throw new Error('decode failed');
      return {
        kind: 'image',
        blob: file,
        fileName: file.name,
        mimeType: 'image/jpeg',
        thumbnail: null,
      };
    };
    const files = ['a.jpg', 'bad.jpg', 'c.jpg'].map((n) => ({
      file: new File(['x'], n, { type: 'image/jpeg' }),
    }));
    const ready: string[] = [];
    const failed: string[] = [];
    await prepareEach(
      files,
      (p) => ready.push(p.fileName),
      (item) => failed.push(item.file.name),
      prepare,
    );
    expect(maxRunning).toBe(1);
    expect(ready).toEqual(['a.jpg', 'c.jpg']);
    expect(failed).toEqual(['bad.jpg']);
  });
});
