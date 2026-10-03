/**
 * Whether a linked step still shows its pattern (D2, D3). Derived, never
 * stored: a diagram whose pattern changed while it was closed must reopen
 * saying so, which a status written at save would hide.
 *
 * - `current`: the creases the scope chooses today are the ones captured —
 *   every line drawn, for a crease pattern; the lines folded, for a fold.
 * - `stale`: they changed; Refresh captures them again.
 * - `missing`: there is nothing to choose — the region is gone, or has no
 *   foldable crease; Relink picks another.
 * - `unknown`: there is no pattern to ask (none is open), or a region cannot
 *   be looked for until the segmentation is ready.
 *
 * Pure.
 */
import type { FoldArtifacts } from '../../engine/types';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import {
  isLockedStep,
  type DiagramCpScope,
  type DiagramCpSource,
  type DiagramReferencesSource,
  type DiagramStep,
} from '../document/diagramDocument';
import { chooseStepCreases, creasesFingerprint, type StepCreaseChoice } from './captureCreases';

export type DiagramLinkStatus = 'current' | 'stale' | 'missing' | 'unknown';

/** A source that points back at the crease pattern: a linked pattern, or a step sent from References. */
export type DiagramLinkedSource = DiagramCpSource | DiagramReferencesSource;

/** A step's link to the crease pattern, when it has one this build can follow. */
export function linkedSourceOf(step: DiagramStep): DiagramLinkedSource | null {
  if (isLockedStep(step)) return null;
  const { source } = step;
  return source?.kind === 'cp' || source?.kind === 'references-step' ? source : null;
}

/**
 * How a link stands. A References step's sheet is a region like any other,
 * fingerprinted on every line in it when it was sent (D6): its picture never
 * follows the pattern, so all its status can say is whether the sheet changed.
 */
/** A step shown as Simulated above 0%: captured again only in Pose (D19). */
export function needsPose(step: DiagramStep): boolean {
  return step.source?.kind === 'cp' && step.source.render.mode === 'simulated' && step.source.render.foldPercent > 0;
}

export function linkStatus(
  source: Pick<DiagramCpSource, 'scope' | 'fingerprint' | 'render'> | DiagramReferencesSource,
  document: OristudioCpDocumentSnapshot | null,
  segmentation: FoldArtifacts | null
): DiagramLinkStatus {
  if (!document) return 'unknown';
  if ('kind' in source && source.kind === 'references-step') {
    const choice = cachedChoice(document, sheetScope(source), segmentation);
    if (choice.status !== 'found') return choice.status;
    // Sent while its sheet matched no region: there were no creases to keep,
    // so nothing to say it changed from.
    if (source.fingerprint === null) return 'unknown';
    return choice.creases.drawnFingerprint === source.fingerprint ? 'current' : 'stale';
  }
  const linked = source as Pick<DiagramCpSource, 'scope' | 'fingerprint' | 'render'>;
  const choice = cachedChoice(document, linked.scope, segmentation);
  if (choice.status !== 'found') return choice.status;
  return creasesFingerprint(choice.creases, linked.render) === linked.fingerprint ? 'current' : 'stale';
}

/** A References step's sheet as a scope: one object per source, so the choice cache keeps it. */
export function sheetScope(source: DiagramReferencesSource): DiagramCpScope {
  let scope = sheetScopes.get(source);
  if (!scope) {
    scope = { kind: 'segment', region: source.region };
    sheetScopes.set(source, scope);
  }
  return scope;
}

const sheetScopes = new WeakMap<DiagramReferencesSource, DiagramCpScope>();

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
