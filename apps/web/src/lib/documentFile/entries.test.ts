import { describe, expect, it, vi } from 'vitest';

import { readEntries } from './entries';
import { NEWER } from './newer';

type Entry = { id: string; size: number } | { id: string; unknown: Record<string, unknown> };

/** A size that is a positive number; a string, a newer build's; anything else, damage. */
function readSized(id: string, entry: Record<string, unknown>): Entry | typeof NEWER | null {
  if (typeof entry.size === 'string') return NEWER;
  return typeof entry.size === 'number' && entry.size > 0 ? { id, size: entry.size } : null;
}

const carry = (id: string, unknown: Record<string, unknown>): Entry => ({ id, unknown });

const read = (value: unknown) => readEntries(value, readSized, carry);

describe('readEntries', () => {
  it('reads each entry in order', () => {
    expect(read([{ id: 'a', size: 1 }, { id: 'b', size: 2 }])).toEqual([
      { id: 'a', size: 1 },
      { id: 'b', size: 2 },
    ]);
  });

  it('is no entries for a value that is not a list', () => {
    for (const value of [undefined, null, {}, 'a', 3]) expect(read(value), String(value)).toEqual([]);
  });

  it('drops an entry that is not a record, or has no id, and reads the rest', () => {
    const value = [7, null, ['a'], { size: 1 }, { id: '', size: 1 }, { id: 3, size: 1 }, { id: 'kept', size: 1 }];
    expect(read(value)).toEqual([{ id: 'kept', size: 1 }]);
  });

  it('drops an entry its reader refuses', () => {
    expect(read([{ id: 'a', size: -1 }, { id: 'b', size: 2 }])).toEqual([{ id: 'b', size: 2 }]);
  });

  it('carries a newer build’s entry as it came', () => {
    const newer = { id: 'a', size: 'large', more: [1, 2] };
    const [carried] = read([newer]);
    expect(carried).toEqual({ id: 'a', unknown: newer });
    expect((carried as { unknown: unknown }).unknown).toBe(newer);
  });

  it('keeps the first entry with an id, and never reads a later one', () => {
    const reader = vi.fn(readSized);
    const entries = readEntries(
      [
        { id: 'a', size: 1 },
        { id: 'a', size: 2 },
        { id: 'b', size: 'large' },
        { id: 'b', size: 3 },
      ],
      reader,
      carry
    );
    expect(entries).toEqual([
      { id: 'a', size: 1 },
      { id: 'b', unknown: { id: 'b', size: 'large' } },
    ]);
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it('lets an entry that was dropped claim no id', () => {
    expect(read([{ id: 'a', size: 0 }, { id: 'a', size: 2 }])).toEqual([{ id: 'a', size: 2 }]);
  });
});
