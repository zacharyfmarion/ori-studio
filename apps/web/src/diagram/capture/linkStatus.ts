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
 * - `unknown`: there is no pattern to ask (none is open), or a sheet cannot
 *   be looked for until the sheet index is ready.
 *
 * Pure.
 */
import type { CpSheetRegion } from '../../cp-workspace/sheets/cpSheetRegions';
import type { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { lineContentFingerprint } from '../../lib/creaseFingerprint';
import {
  isLockedStep,
  isPosedSource,
  type DiagramCpScope,
  type DiagramCpSource,
  type DiagramFoldStepSource,
  type DiagramReferencesSource,
  type DiagramStep,
  type DiagramStyle,
} from '../document/diagramDocument';
import type { FoldLinkContext } from '../fold/foldStepLink';
import { lightingChanged } from '../pictures/lighting';
import { chooseStepCreases, creasesMatch, knownCreasesOf, type KnownCreases, type StepCreaseChoice } from './captureCreases';

export type DiagramLinkStatus = 'current' | 'stale' | 'missing' | 'unknown';

/**
 * A source that points back at what it was made from: a linked pattern, or a
 * step sent from References — both regions of Edit's crease pattern — or a
 * step of a Fold sequence (`diagram/fold/foldStepLink.ts`).
 */
export type DiagramLinkedSource = DiagramCpSource | DiagramReferencesSource | DiagramFoldStepSource;

/** A step's link to what it was made from, when it has one this build can follow. */
export function linkedSourceOf(step: DiagramStep): DiagramLinkedSource | null {
  if (isLockedStep(step)) return null;
  const { source } = step;
  return source?.kind === 'cp' || source?.kind === 'references-step' || source?.kind === 'fold-step' ? source : null;
}

/** The links of Edit's crease pattern, which `linkStatus` tells: a linked pattern, or a References step. */
export type DiagramPatternLinkedSource = Exclude<DiagramLinkedSource, DiagramFoldStepSource>;

/** Everything a link is told against: Edit's pattern and its sheet index, and the Fold sequences and their replay. */
export interface DiagramLinkContext {
  readonly cp: {
    readonly document: OristudioCpDocumentSnapshot | null;
    readonly sheets: CpSheetIndex | null;
  };
  readonly fold: FoldLinkContext;
}

/**
 * How a link stands. A References step's sheet is a region like any other,
 * fingerprinted on every line in it when it was sent (D6): its picture never
 * follows the pattern, so all its status can say is whether the sheet changed.
 */
/** Saved external views and partially simulated steps can only be replaced in Pose. */
export function needsPose(step: DiagramStep): boolean {
  return step.source?.kind === 'cp' && (step.source.render.mode === 'defox' || (step.source.render.mode === 'simulated' && step.source.render.foldPercent > 0));
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
  // A posed capture follows what it was captured from; a References card never does (D6).
  if (step.unknown || !isPosedSource(step.source)) return null;
  const behind = status === 'stale' || (status === 'current' && lightingChanged(step, style));
  if (!behind) return null;
  return needsPose(step) ? 'pose' : 'refresh';
}

/**
 * A step's sheet is found by what it is, not where it sits
 * (`chooseStepCreases`): moved, it is still current; changed in place,
 * stale; moved and changed, missing — it cannot be told from a deleted one.
 */
export function linkStatus(
  source: (Pick<DiagramCpSource, 'scope' | 'fingerprint' | 'render'> & { kind?: 'cp' }) | DiagramReferencesSource,
  document: OristudioCpDocumentSnapshot | null,
  sheets: CpSheetIndex | null
): DiagramLinkStatus {
  if (!document) return 'unknown';
  const known = knownCreasesOf(source);
  const scope = source.kind === 'references-step' ? sheetScope(source) : source.scope;
  const choice = cachedChoice(document, scope, sheets, known);
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
  sheets: CpSheetIndex | null
): CpSheetRegion | null {
  if (!document || !sheets) return null;
  const choice = cachedChoice(document, scope, sheets, known);
  return choice.status === 'found' ? choice.creases.sheet : null;
}

/** {@link stepSheet} for a linked step's or a References step's source. */
export function sourceSheet(
  source: DiagramCpSource | DiagramReferencesSource,
  document: OristudioCpDocumentSnapshot | null,
  sheets: CpSheetIndex | null
): CpSheetRegion | null {
  const scope = source.kind === 'references-step' ? sheetScope(source) : source.scope;
  return stepSheet(scope, knownCreasesOf(source), document, sheets);
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
 * Choices for the lines as they are and the index they were found in, then by
 * scope object, then by what the step remembers: a card asks on every render,
 * and choosing is a walk over the sheets and a digest. Keyed by the lines'
 * content rather than the snapshot, which every kernel command replaces — a
 * selection too — while the choice reads nothing a selection changes. A scope
 * is replaced per capture, never edited, so its identity is the question; the
 * remembered fingerprint is a string, since a Refresh can keep the scope and
 * change it. One slot: one crease pattern is open at a time.
 */
let choices: {
  content: string;
  index: CpSheetIndex;
  byScope: WeakMap<DiagramCpScope, Map<string, StepCreaseChoice>>;
} | null = null;

function cachedChoice(
  document: OristudioCpDocumentSnapshot,
  scope: DiagramCpScope,
  sheets: CpSheetIndex | null,
  known: KnownCreases
): StepCreaseChoice {
  // Nothing to look in yet: a constant answer, not worth a slot.
  if (!sheets) return chooseStepCreases(document, scope, null, known);
  const content = lineContentFingerprint(document);
  if (choices?.content !== content || choices.index !== sheets) {
    choices = { content, index: sheets, byScope: new WeakMap() };
  }
  const { byScope } = choices;
  let byKnown = byScope.get(scope);
  if (!byKnown) {
    byKnown = new Map();
    byScope.set(scope, byKnown);
  }
  const knownKey = `${known.drawn ? 'drawn' : 'fold'}|${known.fingerprint ?? ''}`;
  let choice = byKnown.get(knownKey);
  if (!choice) {
    choice = chooseStepCreases(document, scope, sheets, known);
    byKnown.set(knownKey, choice);
  }
  return choice;
}
