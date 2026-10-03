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
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import {
  isLockedStep,
  type DiagramCpScope,
  type DiagramCpSource,
  type DiagramReferencesSource,
  type DiagramStep,
  type DiagramStyle,
} from '../document/diagramDocument';
import { lightingChanged } from '../pictures/lighting';
import { chooseStepCreases, creasesMatch, knownCreasesOf, type KnownCreases, type StepCreaseChoice } from './captureCreases';

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

/**
 * What bringing a linked step up to date takes, when its pattern changed or
 * its picture was lit by another style: a capture, which Refresh all makes
 * (`refresh`), or Pose, for a step folded part way in the simulator (`pose`).
 * Null for a step that is up to date, not linked to the pattern, or whose
 * link cannot be checked. The one rule for Refresh all and the count it is
 * offered by.
 */
export function refreshKind(
  step: DiagramStep,
  status: DiagramLinkStatus | undefined,
  style: DiagramStyle
): 'refresh' | 'pose' | null {
  if (step.unknown || step.source?.kind !== 'cp') return null;
  const behind = status === 'stale' || (status === 'current' && lightingChanged(step, style));
  if (!behind) return null;
  return needsPose(step) ? 'pose' : 'refresh';
}

/**
 * A step's sheet is found by what it is, not where it sits
 * (`chooseStepCreases`): moved, it is still current; changed, stale; moved
 * and changed among other sheets of its shape, missing.
 */
export function linkStatus(
  source: (Pick<DiagramCpSource, 'scope' | 'fingerprint' | 'render'> & { kind?: 'cp' }) | DiagramReferencesSource,
  document: OristudioCpDocumentSnapshot | null,
  segmentation: FoldArtifacts | null
): DiagramLinkStatus {
  if (!document) return 'unknown';
  const known = knownCreasesOf(source);
  const scope = source.kind === 'references-step' ? sheetScope(source) : source.scope;
  const choice = cachedChoice(document, scope, segmentation, known);
  if (choice.status !== 'found') return choice.status;
  // Sent while its sheet matched no region: there were no creases to keep,
  // so nothing to say it changed from.
  if (known.fingerprint === null) return 'unknown';
  return creasesMatch(choice.creases, known) ? 'current' : 'stale';
}

/**
 * The sheet a step's link names, as the pattern stands now — found as its
 * status finds it, by what it is rather than where it sits — or null: gone,
 * or not to be looked for yet. What the pattern picker marks, Simulated Pose
 * folds, and Open in Edit and Open in References go to.
 */
export function stepSheet(
  scope: DiagramCpScope,
  known: KnownCreases,
  document: OristudioCpDocumentSnapshot | null,
  segmentation: FoldArtifacts | null
): CpSegment | null {
  if (!document || !segmentation) return null;
  const choice = cachedChoice(document, scope, segmentation, known);
  return choice.status === 'found' ? choice.creases.segment : null;
}

/** {@link stepSheet} for a linked step's or a References step's source. */
export function sourceSheet(
  source: DiagramCpSource | DiagramReferencesSource,
  document: OristudioCpDocumentSnapshot | null,
  segmentation: FoldArtifacts | null
): CpSegment | null {
  const scope = source.kind === 'references-step' ? sheetScope(source) : source.scope;
  return stepSheet(scope, knownCreasesOf(source), document, segmentation);
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
 * Choices by document, then segmentation, then scope object, then what the
 * step remembers: a card asks on every render, and choosing is a walk over
 * the pattern and a digest. Each object key is replaced, never edited — a
 * document snapshot per kernel command, a segmentation per crease geometry, a
 * scope per capture — so identity is the whole question, and a superseded
 * one's entries go with it. The remembered fingerprint is a string: a Refresh
 * can keep the scope and change it.
 */
const choices = new WeakMap<
  OristudioCpDocumentSnapshot,
  WeakMap<FoldArtifacts | typeof NO_SEGMENTATION, WeakMap<DiagramCpScope, Map<string, StepCreaseChoice>>>
>();
const NO_SEGMENTATION = {};

function cachedChoice(
  document: OristudioCpDocumentSnapshot,
  scope: DiagramCpScope,
  segmentation: FoldArtifacts | null,
  known: KnownCreases
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
  let byKnown = byScope.get(scope);
  if (!byKnown) {
    byKnown = new Map();
    byScope.set(scope, byKnown);
  }
  const knownKey = `${known.drawn ? 'drawn' : 'fold'}|${known.fingerprint ?? ''}`;
  let choice = byKnown.get(knownKey);
  if (!choice) {
    choice = chooseStepCreases(document, scope, segmentation, known);
    byKnown.set(knownKey, choice);
  }
  return choice;
}
