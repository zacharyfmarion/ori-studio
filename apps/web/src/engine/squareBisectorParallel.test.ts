/**
 * Angle Bisector on parallel sources, through the real wasm kernel.
 *
 * The Rust tests cover the dispatch directly; this covers the same thing across
 * the bridge, because the bridge is where a payload shape can silently stop
 * matching. The coordinates are lifted from `bisector_bug.osf`, where the tool
 * committed a crease ending at ~3.4e14 and buried the editor.
 *
 * Parallel sources take upstream's second interaction: the midline between them,
 * cut between two creases that cross it. Upstream also lets you take that midline
 * whole; that arm is deliberately not dispatched, because it commits an unbounded
 * ray — see the `SquareBisector` dispatch.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { initCpWasm } from './oristudioCpTestSupport';
import {
  document_snapshot,
  execute_cp_command,
  free_document,
  load_cp,
  preview_cp_command,
} from '../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import type { OristudioCpDocumentSnapshot } from './oristudioCpTypes';

/**
 * Ids 1 and 2 are the two parallel creases from the bug report — both slope -1,
 * with a determinant of float noise rather than a clean zero. Ids 3 and 4 cross
 * them, so they can serve as the two destinations the parallel arm cuts between.
 */
const SOURCE_CP = [
  '1 408.57864376269066 549.9999999999991 308.5786437626729 650.0',
  '1 250.0 650.0 343.9339828220211 556.0660171779787',
  '1 300.0 500.0 300.0 700.0',
  '1 400.0 500.0 400.0 700.0',
  '',
].join('\n');

const withDocument = <T,>(run: (handle: number) => T): T => {
  const handle = load_cp(SOURCE_CP, 'parallel-bisector');
  try {
    return run(handle);
  } finally {
    free_document(handle);
  }
};

const largestCoordinate = (handle: number): number => {
  const snapshot = document_snapshot(handle) as OristudioCpDocumentSnapshot;
  return snapshot.crease_pattern.line_segments
    .flatMap((segment) => [segment.a, segment.b])
    .reduce((worst, point) => Math.max(worst, Math.abs(point.x), Math.abs(point.y)), 0);
};

const creaseCount = (handle: number): number =>
  (document_snapshot(handle) as OristudioCpDocumentSnapshot).crease_pattern.line_segments.length;

describe('Angle Bisector across the wasm bridge', () => {
  beforeAll(async () => {
    await initCpWasm();
  });

  it('previews the midline for parallel sources', () => {
    withDocument((handle) => {
      // The surface needs it both to show what the next two picks cut, and to tell
      // which of the two interactions it is in.
      const preview = preview_cp_command(handle, 'SquareBisector', { line_ids: [1, 2] }) as {
        segments: { color: string }[];
      };
      expect(preview.segments).toHaveLength(1);
      expect(preview.segments[0].color).toBe('Purple8');
    });
  });

  it('previews nothing for non-parallel sources', () => {
    withDocument((handle) => {
      const preview = preview_cp_command(handle, 'SquareBisector', { line_ids: [1, 3] }) as {
        segments: unknown[];
      };
      expect(preview.segments).toHaveLength(0);
    });
  });

  it('cuts the midline between two crossing destinations', () => {
    withDocument((handle) => {
      const before = creaseCount(handle);
      execute_cp_command(handle, 'SquareBisector', {
        line_ids: [1, 2, 3, 4],
        line_color: 'Red1',
      });
      expect(creaseCount(handle)).toBeGreaterThan(before);
      expect(largestCoordinate(handle)).toBeLessThan(1_000);
    });
  });

  it('refuses the shapes that would commit an unbounded ray', () => {
    withDocument((handle) => {
      const before = creaseCount(handle);
      // Two ids is upstream's "take the midline whole"; three is the shape for
      // sources that meet. Neither may leak geometry on the way out.
      for (const line_ids of [[1, 2], [1, 2, 3]]) {
        expect(() =>
          execute_cp_command(handle, 'SquareBisector', { line_ids, line_color: 'Red1' })
        ).toThrow();
        expect(creaseCount(handle)).toBe(before);
        expect(largestCoordinate(handle)).toBeLessThan(1_000);
      }
    });
  });

  it('still bisects non-parallel sources to a destination', () => {
    withDocument((handle) => {
      const before = creaseCount(handle);
      execute_cp_command(handle, 'SquareBisector', { line_ids: [1, 3, 4], line_color: 'Red1' });
      expect(creaseCount(handle)).toBeGreaterThan(before);
      expect(largestCoordinate(handle)).toBeLessThan(1_000);
    });
  });
});
