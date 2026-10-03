/**
 * Whether a linked step still shows its pattern (D2, D3). Derived, never
 * stored: a diagram whose pattern changed while it was closed must reopen
 * saying so, which a status written at save would hide.
 *
 * - `current`: the creases the scope chooses today are the ones captured.
 * - `stale`: they changed; Refresh captures them again.
 * - `missing`: there is nothing to choose — the region is gone, or no
 *   foldable crease overlaps the figure's box; Relink picks another.
 * - `unknown`: there is no pattern to ask (none is open), or a region cannot
 *   be looked for until the segmentation is ready.
 *
 * Pure.
 */
import type { FoldArtifacts } from '../../engine/types';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import type { DiagramCpScope, DiagramCpSource } from '../document/diagramDocument';
import { chooseStepCreases, type StepCreaseChoice } from './captureCreases';

export type DiagramLinkStatus = 'current' | 'stale' | 'missing' | 'unknown';

export function linkStatus(
  source: Pick<DiagramCpSource, 'scope' | 'fingerprint'>,
  document: OristudioCpDocumentSnapshot | null,
  segmentation: FoldArtifacts | null
): DiagramLinkStatus {
  if (!document) return 'unknown';
  const choice = cachedChoice(document, source.scope, segmentation);
  if (choice.status !== 'found') return choice.status;
  return choice.creases.fingerprint === source.fingerprint ? 'current' : 'stale';
}

/**
 * Choices by document, then segmentation, then scope object: a card asks on
 * every render, and choosing is a walk over the pattern and a digest. Each
 * key is replaced, never edited — a document snapshot per kernel command, a
 * segmentation per crease geometry, a scope per capture — so identity is the
 * whole question, and a superseded one's entries go with it.
 */
const choices = new WeakMap<
  OristudioCpDocumentSnapshot,
  WeakMap<FoldArtifacts | typeof NO_SEGMENTATION, WeakMap<DiagramCpScope, StepCreaseChoice>>
>();
const NO_SEGMENTATION = {};

function cachedChoice(
  document: OristudioCpDocumentSnapshot,
  scope: DiagramCpScope,
  segmentation: FoldArtifacts | null
): StepCreaseChoice {
  let bySegmentation = choices.get(document);
  if (!bySegmentation) {
    bySegmentation = new WeakMap();
    choices.set(document, bySegmentation);
  }
  const segmentationKey = segmentation ?? NO_SEGMENTATION;
  let byScope = bySegmentation.get(segmentationKey);
  if (!byScope) {
    byScope = new WeakMap();
    bySegmentation.set(segmentationKey, byScope);
  }
  let choice = byScope.get(scope);
  if (!choice) {
    choice = chooseStepCreases(document, scope, segmentation);
    byScope.set(scope, choice);
  }
  return choice;
}
