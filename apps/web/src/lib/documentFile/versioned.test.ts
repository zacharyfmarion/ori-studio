import { describe, expect, it, vi } from 'vitest';

import { readVersioned, writeVersioned, type ReadVersionedOptions } from './versioned';

interface Note {
  formatVersion: 2;
  title: string;
}

const VERSION = 2;

const readNote = (value: Record<string, unknown>): Note => ({
  formatVersion: VERSION,
  title: typeof value.title === 'string' ? value.title : '',
});

const writeNote = (note: Note) => ({ title: note.title });

const options: ReadVersionedOptions<Note> = { version: VERSION, read: readNote };

describe('readVersioned', () => {
  it('is no document for a value that is not a record', () => {
    const read = vi.fn(readNote);
    for (const value of [undefined, null, [], 'note', 2]) {
      expect(readVersioned(value, { version: VERSION, read }), String(value)).toBeNull();
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('reads a document this build or an older one wrote, editable, and keeps the value as read', () => {
    for (const formatVersion of [1, 2]) {
      const value = { formatVersion, title: 'Crane' };
      const read = readVersioned(value, options)!;
      expect(read.document).toEqual({ formatVersion: 2, title: 'Crane' });
      expect(read.readOnly).toBe(false);
      expect(read.raw).toBe(value);
    }
  });

  it('reads a formatVersion that is not a number as the first', () => {
    for (const formatVersion of [undefined, '3', null]) {
      expect(readVersioned({ formatVersion, title: 'Crane' }, options)!.readOnly, String(formatVersion)).toBe(false);
    }
    // As 1, not as whatever this build's version is: a format still at 0 finds it newer.
    expect(readVersioned({ title: 'Crane' }, { ...options, version: 0 })!.readOnly).toBe(true);
  });

  it('opens a newer formatVersion read-only, with a best-effort reading', () => {
    const read = readVersioned({ formatVersion: 3, title: 'Crane', tags: ['bird'] }, options)!;
    expect(read.readOnly).toBe(true);
    expect(read.document).toEqual({ formatVersion: 2, title: 'Crane' });
  });

  it('opens read-only on a field of the document the format cannot carry', () => {
    const newerField = (value: Record<string, unknown>) => (Object.hasOwn(value, 'tags') ? 'tags' : null);
    expect(readVersioned({ formatVersion: 2, title: 'Crane', tags: [] }, { ...options, newerField })!.readOnly).toBe(true);
    expect(readVersioned({ formatVersion: 2, title: 'Crane' }, { ...options, newerField })!.readOnly).toBe(false);
  });
});

describe('writeVersioned', () => {
  it('writes this build’s formatVersion first, then the document’s fields', () => {
    const written = writeVersioned(readNote({ title: 'Crane' }), null, { version: VERSION, write: writeNote });
    expect(Object.keys(written)).toEqual(['formatVersion', 'title']);
    expect(written).toEqual({ formatVersion: 2, title: 'Crane' });
    expect(readVersioned(JSON.parse(JSON.stringify(written)), options)).toMatchObject({ readOnly: false, document: { title: 'Crane' } });
  });

  it('writes a read-only document back as the very value it was read from', () => {
    const write = vi.fn(writeNote);
    const read = readVersioned({ formatVersion: 3, title: 'Crane', tags: ['bird'] }, options)!;
    expect(writeVersioned(read.document, read.raw, { version: VERSION, write })).toBe(read.raw);
    expect(write).not.toHaveBeenCalled();
  });
});
