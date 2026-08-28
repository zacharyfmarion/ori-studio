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
 * resolves it — the same appearance table, and {@link foldAngleInk} rather than
 * one channel of it, so a candidate follows the View panel's fold-angle display
 * mode like every other crease. One that names no crease keeps the active
 * colour, unchanged.
 *
 * # Dashed proposals, one solid answer
 *
 * A completion candidate is drawn as the whole crease it would become, which
 * makes it read as a crease that is already there. Dashing separates the two.
 *
 * And with several on screen and a click-nearest rule, the one a click would
 * commit has to be distinguishable *before* the click — otherwise picking is a
 * guess. So the armed candidate is solid, and it is the only one.
 */
import { foldAngleInk } from '../foldAngle/foldAngleRamp';
import type { OristudioCpFoldAngleDisplay } from '../../lib/creasePatternViewport';
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
  foldAngle: { display: OristudioCpFoldAngleDisplay; anchor: Rgba },
  armed: number | null = null
): PreviewStrokeGroup[] {
  if (segments.length === 0) return [];
  const inkFor = (segment: ToolPreviewSegment): Rgba =>
    segment.crease
      ? foldAngleInk(
          appearanceFor(segment.crease.color).color,
          segment.crease.foldMagnitude,
          foldAngle
        )
      : fallback;

  const named = segments.some((segment) => segment.crease);
  if (!named && armed === null) return [{ segments, color: fallback }];

  // A lone candidate is armed by definition: there is nothing to choose between,
  // so it is already the crease you will get and reads solid from the start —
  // which matches the tool committing it on the vertex click rather than asking
  // for a second one.
  const effectiveArmed = named && segments.length === 1 ? 0 : armed;

  const groups = new Map<string, PreviewStrokeGroup & { segments: ToolPreviewSegment[] }>();
  for (const [index, segment] of segments.entries()) {
    const color = inkFor(segment);
    // The armed candidate is the one a click would commit, and it says so by
    // being solid where the alternatives are dashed. Its own group, keyed apart,
    // so a candidate sharing its colour does not inherit the state.
    const isArmed = index === effectiveArmed;
    const key = `${colorKey(color)}|${isArmed ? 'armed' : 'proposed'}`;
    const group = groups.get(key);
    if (group) group.segments.push(segment);
    else groups.set(key, { color, segments: [segment], dashed: !isArmed });
  }
  return [...groups.values()];
}
