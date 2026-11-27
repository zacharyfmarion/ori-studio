import { describe, expect, it } from 'vitest';
import { FileTooLargeError, type PickedFile } from '../../platform/fileService';
import { FOLD_SAMPLES } from '../engine/foldEngineIoSamples';
import {
  FOLD_IMPORT_MAX_BYTES,
  foldImportFileOrder,
  foldImportFileRequest,
  foldImportFileSource,
  foldImportFormatOf,
  foldSample,
  foldSampleSummary,
} from './foldImportFiles';

/** A picked file whose read answers `read`, and says what cap it was read under. */
function picked(name: string, read: (maxBytes: number) => Promise<Uint8Array>): PickedFile & { caps: number[] } {
  const caps: number[] = [];
  return {
    name,
    type: '',
    size: 0,
    caps,
    read: (maxBytes) => {
      caps.push(maxBytes);
      return read(maxBytes);
    },
  };
}

describe('Import CP files', () => {
  it('reads the four formats the CP kernel loads, by extension, whatever its case', () => {
    expect(['a.cp', 'b.FOLD', 'c.ori', 'd.orh'].map(foldImportFormatOf)).toEqual(['cp', 'fold', 'ori', 'orh']);
    expect(['project.osf', 'tree.tmd5', 'photo.png', 'noextension', 'cp'].map(foldImportFormatOf)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('sends a file as its bytes, and nothing for a format it cannot read', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(foldImportFileSource('crane.orh', bytes)).toEqual({ format: 'orh', bytes });
    expect(foldImportFileSource('crane.osf', bytes)).toBeNull();
  });

  it('imports the crease patterns of a drop by the numbers in their names, and leaves the rest out', () => {
    const files = ['10.cp', 'notes.txt', '9.cp', '25.fold', '7.CP', '.DS_Store', '8.orh'].map((name) => ({ name }));
    expect(foldImportFileOrder(files).map((file) => file.name)).toEqual(['7.CP', '8.orh', '9.cp', '10.cp', '25.fold']);
  });

  it('keeps the first file of a drop with no crease pattern, so the dialog can say what it is not', () => {
    const files = [{ name: 'notes.txt' }, { name: 'photo.png' }];
    expect(foldImportFileOrder(files)).toEqual([files[0]]);
    expect(foldImportFileOrder([])).toEqual([]);
  });

  it('reads a picked file whole, under the cap, as the flow imports it', async () => {
    const bytes = new Uint8Array([49, 32, 48]);
    const file = picked('crane.cp', async () => bytes);
    await expect(foldImportFileRequest(file)).resolves.toEqual({
      kind: 'file',
      name: 'crane.cp',
      source: { format: 'cp', bytes },
    });
    expect(file.caps).toEqual([FOLD_IMPORT_MAX_BYTES]);
  });

  it('never reads a file with no crease-pattern extension', async () => {
    const file = picked('notes.txt', async () => new Uint8Array());
    await expect(foldImportFileRequest(file)).resolves.toEqual({ kind: 'file', name: 'notes.txt', source: null });
    expect(file.caps).toEqual([]);
  });

  it('says a file past the cap is too large, and one the platform fails to read is unreadable', async () => {
    const huge = picked('huge.fold', async () => {
      throw new FileTooLargeError();
    });
    await expect(foldImportFileRequest(huge)).resolves.toEqual({
      kind: 'file',
      name: 'huge.fold',
      source: null,
      tooLarge: true,
    });
    const gone = picked('gone.cp', async () => {
      throw new Error('permission denied');
    });
    await expect(foldImportFileRequest(gone)).resolves.toEqual({
      kind: 'file',
      name: 'gone.cp',
      source: null,
      unreadable: true,
    });
  });
});

describe('the samples', () => {
  it('ships each sample by id, with a picture of its creases and their count', () => {
    for (const sample of FOLD_SAMPLES) {
      expect(foldSample(sample.id)).toBe(sample);
      const summary = foldSampleSummary(sample);
      expect(summary.thumbnail?.strokes.length, sample.id).toBeGreaterThan(4);
      // Four border edges at least, drawn as the paper's edge over the creases.
      expect(summary.thumbnail?.strokes.at(-1)?.role).toBe('edge');
      expect(summary.creases, sample.id).toBeGreaterThan(0);
      expect(foldSampleSummary(sample)).toBe(summary);
    }
  });

  it('counts the preliminary base’s creases and reads its precreases as unassigned', () => {
    const summary = foldSampleSummary(foldSample('preliminary-base')!);
    expect(summary.creases).toBe(8);
    const roles = summary.thumbnail!.strokes.map((stroke) => stroke.role);
    expect(roles.filter((role) => role === 'mountain')).toHaveLength(4);
    expect(roles.filter((role) => role === 'valley')).toHaveLength(2);
    expect(roles.filter((role) => role === 'unassigned')).toHaveLength(2);
  });
});
