/**
 * Which creases a linked region is made of (D3), chosen the one way the
 * Diagram's capture, Refresh and link status and Fold's Import CP all use:
 * from the document snapshot the capture starts from, so a link can never read
 * stale against the pattern it was just made from.
 *
 * A link finds its sheet by what it is, not where it sits
 * (implementation-plans/pattern-identity.md): the one still in its place,
 * unchanged or edited there; else a sheet of the same outline whose creases
 * are the ones it remembers, wherever it is now (`resolveMovedRegion`, among
 * the sheets of the index the selection toolbar uses). It is made of every
 * line the index puts in it. What is folded — and what
 * {@link StepCreases.fingerprint} is taken over — is the sheet's foldable
 * lines, in kernel order.
 *
 * Fingerprints are relative (`rc1:`), so a move is not a change. A link that
 * keeps an absolute one (`cs1:`, written before) is compared the old way, and
 * its next capture writes `rc1:`.
 *
 * Pure: no store, no kernel.
 */
import type { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { cpLinesByIds, foldedSourceFingerprint } from '../folded/foldedFigureStaleness';
import { kernelLineOrder } from '../folded/foldRoute';
import {
  isRelativeFingerprint,
  relativeCreaseFingerprint,
  resolveMovedRegion,
  type RegionFound,
} from './regionIdentity';
import { resolveRegion, type RegionReference } from './regionReference';
import { sheetRegions, type CpSheetRegion } from '../sheets/cpSheetRegions';
import { selectedFoldableCpLineIds } from '../../lib/creasePatternClipboard';
import { lineContentFingerprint } from '../../lib/creaseFingerprint';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import type { Point } from '../../lib/geometry';

/** A region of the open pattern a link names: a sheet, by its outline. */
export type RegionCreaseScope = { kind: 'segment'; region: RegionReference };

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
  /** The same two as absolute fingerprints (`cs1:`), for a link that keeps one from before. */
  absolute: { fingerprint: string; drawnFingerprint: string };
  /** The paper the sheet covers, in pattern units: its outline. A crease-pattern picture fills it. */
  paper: Point[][];
  /** The sheet: what its thumbnail is drawn from and its simulated model built for. */
  sheet: CpSheetRegion;
  /** How the region was found: unchanged (wherever it is), in its place, or as the only one of its shape. */
  found: RegionFound;
}

/**
 * What a link remembers of its creases: the fingerprint it keeps, and whether
 * it was taken over every line drawn (a crease-pattern picture, a References
 * card) or the lines folded.
 */
export interface KnownCreases {
  fingerprint: string | null;
  drawn: boolean;
}

/**
 * A scope's creases today, or why there are none:
 * - `missing`: the sheet is gone (merged, split, no longer closed by its
 *   border, or moved and changed among others of its shape), or has no
 *   foldable crease;
 * - `unknown`: a sheet cannot be looked for yet, because the sheet index is
 *   not ready.
 */
export type StepCreaseChoice =
  | { status: 'found'; creases: StepCreases }
  | { status: 'missing' }
  | { status: 'unknown' };

/**
 * The scope's creases today. `known` is what the link remembers, which lets
 * it find its sheet after a move; without it (a link being made now, to a
 * sheet just taken from this index) the sheet is found where it is.
 */
export function chooseRegionCreases(
  document: OristudioCpDocumentSnapshot,
  scope: RegionCreaseScope,
  sheets: CpSheetIndex | null,
  known: KnownCreases | null = null
): StepCreaseChoice {
  if (!sheets) return { status: 'unknown' };
  const regions = sheetRegions(sheets);
  const creasesOf = (sheet: CpSheetRegion) => sheetCreases(document, sheets, sheet);
  const resolved = known
    ? resolveMovedRegion(scope.region, regions, {
        fingerprint: known.fingerprint,
        fingerprintOf: (sheet) => {
          const creases = creasesOf(sheet);
          return creases ? (known.drawn ? creases.drawnFingerprint : creases.fingerprint) : null;
        },
      })
    : inPlace(scope, regions);
  if (!resolved) return { status: 'missing' };
  const creases = creasesOf(resolved.segment);
  if (!creases) return { status: 'missing' };
  return { status: 'found', creases: { ...creases, found: resolved.found } };
}

/**
 * Sheet `sheet` of `sheets`' creases, as a link made to it now would choose
 * them (`chooseRegionCreases`): taken from the index itself, so nothing is
 * looked for. Null for a sheet the index lacks, or one with no foldable crease.
 */
export function creasesOfSheet(
  document: OristudioCpDocumentSnapshot,
  sheets: CpSheetIndex,
  sheet: number
): StepCreases | null {
  const region = sheetRegions(sheets)[sheet];
  const creases = region ? sheetCreases(document, sheets, region) : null;
  return creases ? { ...creases, found: 'in-place' } : null;
}

function inPlace(scope: RegionCreaseScope, regions: readonly CpSheetRegion[]) {
  const segment = resolveRegion(scope.region, regions);
  return segment ? { segment, found: 'in-place' as const } : null;
}

/** Whether the creases chosen today are the ones a link remembers, by the rule its fingerprint was taken with. */
export function creasesMatch(creases: StepCreases, known: KnownCreases): boolean {
  if (known.fingerprint === null) return false;
  if (isRelativeFingerprint(known.fingerprint)) {
    return (known.drawn ? creases.drawnFingerprint : creases.fingerprint) === known.fingerprint;
  }
  return (known.drawn ? creases.absolute.drawnFingerprint : creases.absolute.fingerprint) === known.fingerprint;
}

/**
 * A sheet's creases in this document, or null when it has none to fold:
 * worked out once per sheet while the lines stay as they are, since finding a
 * moved sheet asks it of every sheet of the same shape, and every linked card
 * asks for its own.
 */
function sheetCreases(
  document: OristudioCpDocumentSnapshot,
  index: CpSheetIndex,
  sheet: CpSheetRegion
): Omit<StepCreases, 'found'> | null {
  // Keyed by the lines' content, not the snapshot: a selection replaces the
  // snapshot and changes nothing a fingerprint reads, and recomputing every
  // card's fingerprints on each one cost the diagram seconds on a large canvas.
  const content = lineContentFingerprint(document);
  if (sheetCache?.content !== content || sheetCache.index !== index) {
    sheetCache = { content, index, bySheet: new Map() };
  }
  const cached = sheetCache.bySheet.get(sheet.id);
  if (cached !== undefined) return cached;
  const scopedLineIds = [...sheet.lineIds];
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
            paper: sheet.boundary,
            sheet,
          };
        })();
  sheetCache.bySheet.set(sheet.id, creases);
  return creases;
}

/** One slot: one crease pattern is open, and superseded lines are not asked about again. */
let sheetCache: {
  content: string;
  index: CpSheetIndex;
  bySheet: Map<number, Omit<StepCreases, 'found'> | null>;
} | null = null;
