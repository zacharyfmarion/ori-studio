/**
 * The Diagram's source and render adapters over the shared region capture
 * (`cp-workspace/regions/regionCreases.ts`): which creases a linked step is
 * made of is chosen there, among the sheets of the index, the one way capture,
 * Refresh, link status and Fold's Import CP all use.
 */
import { boundariesMatch, regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { creasesMatch, type StepCreases, type KnownCreases } from '../../cp-workspace/regions/regionCreases';
import type { DiagramCpRender, DiagramCpScope, DiagramCpSource, DiagramReferencesSource } from '../document/diagramDocument';
export { chooseRegionCreases as chooseStepCreases, creasesMatch } from '../../cp-workspace/regions/regionCreases';
export type { StepCreases, KnownCreases, StepCreaseChoice } from '../../cp-workspace/regions/regionCreases';

/** A linked step's source, or as much of it as says what it remembers. */
export type LinkedCreasesSource =
  | (Pick<DiagramCpSource, 'fingerprint' | 'render'> & Partial<Pick<DiagramCpSource, 'drawnFingerprint'>> & { kind?: 'cp' })
  | DiagramReferencesSource;

/** What a linked step or a References step remembers of its creases. */
export function knownCreasesOf(source: LinkedCreasesSource): KnownCreases {
  if (source.kind === 'references-step') return { fingerprint: source.fingerprint, drawn: true };
  return { fingerprint: source.fingerprint, drawn: source.render.mode === 'crease-pattern' };
}

/**
 * The fingerprint a step keeps for its creases, by how it shows them: a
 * crease pattern is of every line it draws, a fold of the lines it folds —
 * an aux line changes the one and not the other. Always relative: what a
 * capture writes. A fold's picture draws its sheet's aux lines too, which
 * {@link drawnLinesFingerprint} keeps beside it.
 */
export function creasesFingerprint(creases: StepCreases, render: Pick<DiagramCpRender, 'mode'>): string {
  return render.mode === 'crease-pattern' ? creases.drawnFingerprint : creases.fingerprint;
}

/**
 * What a capture keeps besides {@link creasesFingerprint}: for a picture that
 * folds its sheet (flat, 3D or simulated), every line the sheet holds, since
 * each draws the sheet's aux lines on its paper. None for a crease pattern,
 * whose fingerprint is of every line already, or a saved Defox view, which
 * draws none of the pattern's lines.
 */
export function drawnLinesFingerprint(creases: StepCreases, render: Pick<DiagramCpRender, 'mode'>): string | undefined {
  return render.mode === 'crease-pattern' || render.mode === 'defox' ? undefined : creases.drawnFingerprint;
}

/**
 * Whether the sheet chosen today holds the lines a folded picture drew, by
 * the rule its drawn-lines fingerprint was taken with. True for a link that
 * kept none — a crease pattern, a References card, or a link saved before
 * folded pictures kept one — which its fingerprint alone answers for.
 */
export function drawnLinesMatch(creases: StepCreases, source: LinkedCreasesSource): boolean {
  if (source.kind === 'references-step' || source.drawnFingerprint === undefined) return true;
  return creasesMatch(creases, { fingerprint: source.drawnFingerprint, drawn: true });
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
