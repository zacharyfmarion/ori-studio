import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedRenderSnapshot,
} from '../engine/oristudioCpTypes';
import { selectedFoldableCpLineIds } from './creasePatternClipboard';
import { emptyOristudioCpSelection } from './creasePatternViewport';
import {
  pointInSegment,
  pointOnSegmentBoundary,
  type CpSegment,
} from './creasePatternSegmentation';

/**
 * The kernel calls an export needs to fold a pattern. Injected so this module
 * stays free of the wasm runtime — the store supplies the real bindings and
 * tests supply fakes.
 */
export interface CreaseExportFoldRuntime {
  fold: (
    startingFaceId: number,
    order: 'Order5',
    model: OristudioCpFoldedFigureModel | undefined,
    lineIds: number[]
  ) => Promise<{ handle: number; discoveredCases: number }>;
  /** Advance the figure to a later layer-ordering solution. */
  foldToCase: (handle: number, objective: number) => Promise<{ discoveredCases: number }>;
  renderSnapshot: (handle: number) => Promise<OristudioCpFoldedRenderSnapshot | null>;
  free: (handle: number) => Promise<void>;
}

export interface CreaseExportFoldResult {
  snapshot: OristudioCpFoldedRenderSnapshot;
  /** How many layer-ordering solutions the kernel has found so far. */
  discoveredCases: number;
}

/**
 * Crease-pattern line ids belonging to `segment`, or every foldable line when
 * the whole document is exported.
 *
 * The exported FOLD is written straight from the kernel's model coordinates, so
 * a segment's bounds and a line's endpoints live in the same space and a
 * midpoint containment test is enough to attribute a line to a pattern.
 */
export function foldableLineIdsForSegment(
  document: OristudioCpDocumentSnapshot,
  segment: CpSegment | null
): number[] {
  const lines = document.crease_pattern.line_segments;
  const candidates: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (segment) {
      const midpoint = { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 };
      // A border crease lies *on* the boundary, where the inside test is
      // undefined — so it counts as belonging to the pattern it bounds.
      if (!pointInSegment(segment, midpoint) && !pointOnSegmentBoundary(segment, midpoint)) {
        continue;
      }
    }
    // Crease ids are 1-based.
    candidates.push(index + 1);
  }
  return selectedFoldableCpLineIds(document, {
    ...emptyOristudioCpSelection(),
    lines: candidates,
  });
}

/**
 * Fold one crease pattern and return its drawing primitives.
 *
 * Deliberately ephemeral: the figure never becomes a canvas entry, so exporting
 * adds nothing to the document, the undo stack, or the dirty flag — and the
 * kernel handle is freed whether or not the render succeeds.
 */
export async function foldSegmentForExport(
  runtime: CreaseExportFoldRuntime,
  document: OristudioCpDocumentSnapshot,
  segment: CpSegment | null,
  model?: OristudioCpFoldedFigureModel,
  foldCase = 1
): Promise<CreaseExportFoldResult> {
  const lineIds = foldableLineIdsForSegment(document, segment);
  if (lineIds.length === 0) {
    throw new Error('This crease pattern has no foldable creases');
  }

  const folded = await runtime.fold(1, 'Order5', model, lineIds);
  const handle = folded.handle;
  try {
    // Case 1 is what the fold already produced; later cases are reached by
    // asking the kernel to keep searching from the same handle.
    let discoveredCases = folded.discoveredCases;
    if (foldCase > 1) {
      discoveredCases = (await runtime.foldToCase(handle, foldCase)).discoveredCases;
    }
    const snapshot = await runtime.renderSnapshot(handle);
    if (!snapshot?.primitives.length) {
      throw new Error('The folded figure produced nothing to draw');
    }
    return { snapshot, discoveredCases: Math.max(1, discoveredCases) };
  } finally {
    await runtime.free(handle);
  }
}
