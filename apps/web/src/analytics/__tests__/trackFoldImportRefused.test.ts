import { beforeEach, expect, it, vi } from 'vitest';
import type { FoldRefusalBody } from '../../fold/engine/foldEngineWire';

/**
 * An Import CP the dialog refused is counted as `fold refused`, by its code
 * alone — the engine's or the dialog's own — and one over the face cap with
 * its face count bucketed: never the count itself, a file name or a point.
 */

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const { trackFoldImportRefused } = await import('../trackFoldIo');

const engine = (refusal: Record<string, unknown>) =>
  ({ kind: 'engine', refused: { refusal: refusal as FoldRefusalBody } }) as const;

beforeEach(() => {
  runtime.track.mockClear();
});

it('counts the engine’s refusal by its code, without the points it names', () => {
  trackFoldImportRefused(engine({ code: 'import_crease_not_chord', segment: 3, point: [0.5, 0.25] }));
  expect(runtime.track).toHaveBeenCalledExactlyOnceWith('fold refused', { code: 'import_crease_not_chord' });
});

it('counts the dialog’s own refusal by its code, without the file’s name', () => {
  trackFoldImportRefused({ kind: 'local', code: 'unsupported_file', name: 'crane.svg' });
  expect(runtime.track).toHaveBeenCalledExactlyOnceWith('fold refused', { code: 'unsupported_file' });
});

it('buckets how many faces a pattern over the cap had', () => {
  for (const [faceCount, bucket] of [
    [4160, '<=8192'],
    [10000, '<=16384'],
    [25600, '<=32768'],
    [40000, '>32768'],
  ] as const) {
    trackFoldImportRefused(engine({ code: 'import_too_many_faces', face_count: faceCount, limit: 4096 }));
    expect(runtime.track).toHaveBeenLastCalledWith('fold refused', {
      code: 'import_too_many_faces',
      face_count_bucket: bucket,
    });
  }
});

it('buckets how deep a pattern stacked past the cap stacks, never its exact counts', () => {
  for (const [deepest, bucket] of [
    [150, '<=200'],
    [290, '<=300'],
    [480, '<=500'],
    [604, '>500'],
  ] as const) {
    trackFoldImportRefused(engine({ code: 'import_stacked_too_deep', deepest, triples: 68_288_441, limit: 4_000_000 }));
    expect(runtime.track).toHaveBeenLastCalledWith('fold refused', {
      code: 'import_stacked_too_deep',
      stack_depth_bucket: bucket,
    });
  }
});
