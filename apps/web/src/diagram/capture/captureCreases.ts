/**
 * Which creases a linked step is made of (D3), chosen the one way capture,
 * Refresh and link status all use: from the document snapshot the capture
 * starts from, so a step can never read stale against the pattern it was just
 * made from.
 *
 * A step finds its sheet by what it is, not where it sits
 * (implementation-plans/pattern-identity.md): the one still in its place,
 * unchanged or edited there; else a sheet of the same outline whose creases
 * are the ones it remembers, wherever it is now (`resolveMovedRegion`, in the
 * kernel-space segmentation the selection toolbar uses). It is made of
 * every crease inside it. What is folded — and what {@link StepCreases.fingerprint}
 * is taken over — is the region's foldable lines, in kernel order.
 *
 * Fingerprints are relative (`rc1:`), so a move is not a change. A step that
 * keeps an absolute one (`cs1:`, written before) is compared the old way, and
 * its next capture writes `rc1:`.
 *
 * Pure: no store, no kernel.
 */
import type { FoldArtifacts } from '../../engine/types';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { cpLinesByIds, foldedSourceFingerprint } from '../../cp-workspace/folded/foldedFigureStaleness';
import { kernelLineOrder } from '../../cp-workspace/folded/foldRoute';
import {
  isRelativeFingerprint,
  relativeCreaseFingerprint,
  resolveMovedRegion,
  type RegionFound,
} from '../../cp-workspace/regions/regionIdentity';
import { boundariesMatch, regionReferenceFor, resolveRegion } from '../../cp-workspace/regions/regionReference';
import { selectedFoldableCpLineIds } from '../../lib/creasePatternClipboard';
import { resolveCpSegments, type CpSegment } from '../../lib/creasePatternSegmentation';
import { segmentContainedLineIds } from '../../lib/creasePatternSelectionSegment';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import type { Point } from '../../lib/geometry';
import type {
  DiagramCpRender,
  DiagramCpScope,
  DiagramCpSource,
  DiagramReferencesSource,
} from '../document/diagramDocument';

export interface StepCreases {
  /** Every line the scope covers, aux lines included: what a crease-pattern picture draws. */
  scopedLineIds: number[];
  /** The scope's foldable lines, in kernel order: what is folded, and what {@link fingerprint} covers. */
  foldLineIds: number[];
  /** The relative fingerprint (`rc1:`) over {@link foldLineIds}: what a folded picture is of. */
  fingerprint: string;
  /**
   * The relative fingerprint over {@link scopedLineIds}: what a crease-pattern
   * picture draws, aux lines included, so moving one marks it out of date.
   */
  drawnFingerprint: string;
  /** The same two as absolute fingerprints (`cs1:`), for a step that keeps one from before. */
  absolute: { fingerprint: string; drawnFingerprint: string };
  /** The paper the region covers, in pattern units: its rim. A crease-pattern picture fills it. */
  paper: Point[][];
  /** The region: what its thumbnail is drawn from. */
  segment: CpSegment;
  /** How the region was found: unchanged (wherever it is), in its place, or as the only one of its shape. */
  found: RegionFound;
}

/**
 * What a step remembers of its creases: the fingerprint it keeps, and whether
 * it was taken over every line drawn (a crease-pattern picture, a References
 * card) or the lines folded.
 */
export interface KnownCreases {
  fingerprint: string | null;
  drawn: boolean;
}

/** A linked step's source, or as much of it as says what it remembers. */
export type LinkedCreasesSource = (Pick<DiagramCpSource, 'fingerprint' | 'render'> & { kind?: 'cp' }) | DiagramReferencesSource;

/** What a linked step or a References step remembers of its creases. */
export function knownCreasesOf(source: LinkedCreasesSource): KnownCreases {
  if (source.kind === 'references-step') return { fingerprint: source.fingerprint, drawn: true };
  return { fingerprint: source.fingerprint, drawn: source.render.mode === 'crease-pattern' };
}

/**
 * A scope's creases today, or why there are none:
 * - `missing`: the region is gone (merged, split, its rim no longer all
 *   border, or moved and changed among others of its shape), or has no
 *   foldable crease;
 * - `unknown`: a region cannot be looked for yet, because the segmentation is
 *   not ready.
 */
export type StepCreaseChoice =
  | { status: 'found'; creases: StepCreases }
  | { status: 'missing' }
  | { status: 'unknown' };

/**
 * The scope's creases today. `known` is what the step remembers, which lets
 * it find its sheet after a move; without it (a link being made now, to a
 * region just taken from this segmentation) the region is found where it is.
 */
export function chooseStepCreases(
  document: OristudioCpDocumentSnapshot,
  scope: DiagramCpScope,
  segmentation: FoldArtifacts | null,
  known: KnownCreases | null = null
): StepCreaseChoice {
  if (!segmentation) return { status: 'unknown' };
  const segments = resolveCpSegments(segmentation);
  const creasesOf = (segment: CpSegment) => regionCreases(document, segmentation, segment);
  const resolved = known
    ? resolveMovedRegion(scope.region, segments, {
        fingerprint: known.fingerprint,
        fingerprintOf: (segment) => {
          const creases = creasesOf(segment);
          return creases ? (known.drawn ? creases.drawnFingerprint : creases.fingerprint) : null;
        },
      })
    : inPlace(scope, segments);
  if (!resolved) return { status: 'missing' };
  const creases = creasesOf(resolved.segment);
  if (!creases) return { status: 'missing' };
  return { status: 'found', creases: { ...creases, found: resolved.found } };
}

function inPlace(scope: DiagramCpScope, segments: readonly CpSegment[]) {
  const segment = resolveRegion(scope.region, segments);
  return segment ? { segment, found: 'in-place' as const } : null;
}

/** Whether the creases chosen today are the ones a step remembers, by the rule its fingerprint was taken with. */
export function creasesMatch(creases: StepCreases, known: KnownCreases): boolean {
  if (known.fingerprint === null) return false;
  if (isRelativeFingerprint(known.fingerprint)) {
    return (known.drawn ? creases.drawnFingerprint : creases.fingerprint) === known.fingerprint;
  }
  return (known.drawn ? creases.absolute.drawnFingerprint : creases.absolute.fingerprint) === known.fingerprint;
}

/**
 * A region's creases in this document, or null when it has none to fold:
 * worked out once per document, segmentation and region, since finding a
 * moved sheet asks it of every sheet of the same shape.
 */
function regionCreases(
  document: OristudioCpDocumentSnapshot,
  segmentation: FoldArtifacts,
  segment: CpSegment
): Omit<StepCreases, 'found'> | null {
  let bySegmentation = regionCache.get(document);
  if (!bySegmentation) {
    bySegmentation = new WeakMap();
    regionCache.set(document, bySegmentation);
  }
  let bySegment = bySegmentation.get(segmentation);
  if (!bySegment) {
    bySegment = new WeakMap();
    bySegmentation.set(segmentation, bySegment);
  }
  if (bySegment.has(segment)) return bySegment.get(segment) ?? null;
  const scopedLineIds = segmentContainedLineIds(document, segmentation, segment);
  const foldLineIds = kernelLineOrder(
    selectedFoldableCpLineIds(document, { ...emptyOristudioCpSelection(), lines: scopedLineIds })
  );
  const creases =
    foldLineIds.length === 0
      ? null
      : (() => {
          const folded = cpLinesByIds(document, foldLineIds);
          const drawn = cpLinesByIds(document, scopedLineIds);
          return {
            scopedLineIds,
            foldLineIds,
            fingerprint: relativeCreaseFingerprint(folded),
            drawnFingerprint: relativeCreaseFingerprint(drawn),
            absolute: { fingerprint: foldedSourceFingerprint(folded), drawnFingerprint: foldedSourceFingerprint(drawn) },
            paper: segment.boundary,
            segment,
          };
        })();
  bySegment.set(segment, creases);
  return creases;
}

const regionCache = new WeakMap<
  OristudioCpDocumentSnapshot,
  WeakMap<FoldArtifacts, WeakMap<CpSegment, Omit<StepCreases, 'found'> | null>>
>();

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
  if (boundariesMatch(scope.region.boundary, creases.segment.boundary)) return scope;
  return { kind: 'segment', region: regionReferenceFor(creases.segment) };
}
