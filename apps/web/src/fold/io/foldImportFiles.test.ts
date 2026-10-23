import { describe, expect, it } from 'vitest';
import { FOLD_SAMPLES } from '../engine/foldEngineIoSamples';
import { foldImportFileSource, foldImportFormatOf, foldSample, foldSampleSummary } from './foldImportFiles';

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
