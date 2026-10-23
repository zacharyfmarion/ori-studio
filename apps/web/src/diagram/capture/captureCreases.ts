/**
 * The Diagram's source and render adapters over the shared region capture
 * (`cp-workspace/regions/regionCreases.ts`): which creases a linked step is
 * made of is chosen there, among the sheets of the index, the one way capture,
 * Refresh, link status and Fold's Import CP all use.
 */
import { boundariesMatch, regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import type { StepCreases, KnownCreases } from '../../cp-workspace/regions/regionCreases';
import type { DiagramCpRender, DiagramCpScope, DiagramCpSource, DiagramReferencesSource } from '../document/diagramDocument';
export { chooseRegionCreases as chooseStepCreases, creasesMatch } from '../../cp-workspace/regions/regionCreases';
export type { StepCreases, KnownCreases, StepCreaseChoice } from '../../cp-workspace/regions/regionCreases';

/** A linked step's source, or as much of it as says what it remembers. */
export type LinkedCreasesSource = (Pick<DiagramCpSource, 'fingerprint' | 'render'> & { kind?: 'cp' }) | DiagramReferencesSource;

/** What a linked step or a References step remembers of its creases. */
export function knownCreasesOf(source: LinkedCreasesSource): KnownCreases {
  if (source.kind === 'references-step') return { fingerprint: source.fingerprint, drawn: true };
  return { fingerprint: source.fingerprint, drawn: source.render.mode === 'crease-pattern' };
}

/**
 * The fingerprint a step keeps for its creases, by how it shows them: a
 * crease pattern is of every line it draws, a fold of the lines it folds —
 * an aux line changes the one and not the other. Always relative: what a
 * capture writes.
 */
export function creasesFingerprint(creases: StepCreases, render: Pick<DiagramCpRender, 'mode'>): string {
  return render.mode === 'crease-pattern' ? creases.drawnFingerprint : creases.fingerprint;
}

/**
 * The scope a capture keeps: the one it was asked with while the sheet is
 * where it was, else the sheet where it is now — so a step found after a
 * move follows its sheet, and Open in Edit and Open in References go there.
 */
export function followedScope(scope: DiagramCpScope, creases: StepCreases): DiagramCpScope {
  if (boundariesMatch(scope.region.boundary, creases.sheet.boundary)) return scope;
  return { kind: 'segment', region: regionReferenceFor(creases.sheet) };
}
