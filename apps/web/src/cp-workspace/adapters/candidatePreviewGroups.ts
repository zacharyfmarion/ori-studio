/**
 * Stroke colours for a tool's candidate geometry.
 *
 * Almost every tool draws in the active line type, so its candidates are stroked
 * in one colour and that is the end of it. The vertex-completion tool is the
 * exception: its solver works out the mountain/valley *and* the fold angle of the
 * crease that closes a vertex, and that answer is the tool's entire output. A
 * candidate stroked in the active colour would be showing the user a different
 * crease from the one the commit makes.
 *
 * So a candidate that names a crease is resolved exactly the way the document
 * resolves it — the same appearance table, the same fold-angle ramp — and one
 * that does not keeps the active colour, unchanged.
 */
import { applyFoldAngleRamp } from '../foldAngle/foldAngleRamp';
import type { PreviewStrokeGroup } from '../renderer/previewStrokes';
import type { Rgba } from '../renderer/types';
import type { ToolPreviewSegment } from '../tools/types';
import type { CpLineAppearanceFor } from './cpSnapshotToScene';

/** Key a resolved colour so candidates sharing one land in the same group. */
function colorKey(color: Rgba): string {
  return color.join(',');
}

/**
 * Group candidate segments by the colour they should be stroked in.
 *
 * Returns a single `fallback` group when no candidate names a crease, which is
 * every tool but one — so the common path produces exactly the one group it
 * produced before candidates could carry a crease.
 */
export function candidatePreviewGroups(
  segments: readonly ToolPreviewSegment[],
  fallback: Rgba,
  appearanceFor: CpLineAppearanceFor,
  foldAngleAnchor: Rgba
): PreviewStrokeGroup[] {
  if (segments.length === 0) return [];
  if (!segments.some((segment) => segment.crease)) {
    return [{ segments, color: fallback }];
  }

  const groups = new Map<string, { color: Rgba; segments: ToolPreviewSegment[] }>();
  for (const segment of segments) {
    const color = segment.crease
      ? applyFoldAngleRamp(
          appearanceFor(segment.crease.color).color,
          segment.crease.foldMagnitude,
          foldAngleAnchor
        )
      : fallback;
    const key = colorKey(color);
    const group = groups.get(key);
    if (group) group.segments.push(segment);
    else groups.set(key, { color, segments: [segment] });
  }
  return [...groups.values()];
}
