import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import {
  resolveSelectedSegment,
  type SelectedSegmentMatch,
} from '../../lib/creasePatternSelectionSegment';
import {
  ensureCpSegmentationArtifacts,
  peekCpSegmentationArtifacts,
} from '../cpSegmentationArtifacts';

/**
 * The single border-enclosed region a set of crease ids exactly constitutes, or
 * `null` when they span more than one region, leave part of one unselected, or
 * name a region whose rim is not all border creases.
 *
 * A simulation is always of a *region* — the simulation fold is built from a
 * segment's faces, so it needs a closed piece of paper — and every caller that
 * wants to open one has to answer this question first. Shared rather than
 * duplicated because the two callers reach it from opposite directions: the
 * selection toolbar and `Shift+S` ask about the live selection, while the
 * non-flat fold dialog asks about the ids the fold was already scoped to, which
 * by then may no longer be selected.
 *
 * Takes ids rather than a whole selection for that second caller: only `lines`
 * participates in the match, and a caller holding a captured id list should not
 * have to fabricate the rest of a selection to ask.
 *
 * Segmenting a large pattern takes about a second, so this peeks the shared cache
 * first and only waits when nothing is cached — which happens when no toolbar has
 * mounted to warm it.
 */
export async function resolveInlineSimulationRegion(
  document: OristudioCpDocumentSnapshot | null | undefined,
  lineIds: readonly number[]
): Promise<SelectedSegmentMatch | null> {
  if (!document || lineIds.length === 0) return null;
  const artifacts =
    peekCpSegmentationArtifacts(document) ?? (await ensureCpSegmentationArtifacts(document));
  return resolveSelectedSegment(
    document,
    { ...emptyOristudioCpSelection(), lines: [...lineIds] },
    artifacts
  );
}
