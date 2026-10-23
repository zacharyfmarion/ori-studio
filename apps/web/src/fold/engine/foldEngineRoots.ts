/**
 * An axiom's roots, with the layers at the root a tool takes (plan D14
 * tier 2), in one turn of the worker.
 *
 * A fold located by an axiom has no line until the engine names its roots,
 * and a tool that folds the top flap then asks the cross-section at the root
 * it takes, on the side that moves, to read that flap
 * (`useFoldLineSection`). That second question waits on the first's round
 * trip, so it is asked here with it, at the very line and side the tool will
 * ask about: the root carried into the scene and back by the scene's own
 * `view_transform` ({@link sceneLineOf}, {@link modelLineOf}), as
 * `lineSectionProbe` carries it, on the side the root implies (the other one
 * when the tool swapped it), or on both when it implies none. The tool finds
 * the answer under that line and side (`foldCrossSectionQuery`); one that
 * comes out different in any bit is simply asked again.
 *
 * Nothing is computed differently: each section is the engine's
 * `crossSection` of that line and side. An envelope belongs to the one
 * section it failed (it is asked again, alone); a trap is thrown, as every
 * call's is (`foldEnginePreview.ts`).
 *
 * Pure: no React, no store, no wasm import (the calls are handed in).
 */

import type { FoldModelLine } from '../document/foldSequenceDocument';
import { modelLineOf, sceneLineOf } from '../canvas/foldCanvasGeometry';
import type { FoldEngineCalls } from './foldEngineCalls';
import { foldEngineAnswer, type FoldPreviewAnswer } from './foldEnginePreview';
import type {
  FoldAxiomCandidates,
  FoldAxiomLine,
  FoldEngineOutcome,
  FoldIsometry,
  FoldSectioned,
  FoldSide,
} from './foldEngineWire';

/** Which root's layers a tool will ask for, and how its line is carried: what the tool knows as it asks for the roots. */
export interface FoldRootSectionHint {
  /** The state's scene's `view_transform`. */
  readonly viewTransform: FoldIsometry;
  /** The root the tool takes (the first when there is no such root). */
  readonly root: number;
  /** The tool folds the other side. */
  readonly swapped: boolean;
}

/** The layers at one root, on one side. */
export interface FoldRootSection {
  readonly line: FoldModelLine;
  readonly side: FoldSide;
  readonly section: FoldPreviewAnswer<FoldEngineOutcome<FoldSectioned>>;
}

export interface FoldRootsAnswered {
  readonly candidates: FoldEngineOutcome<FoldAxiomCandidates>;
  /** Empty without a hint, or when there is no root. */
  readonly sections: readonly FoldRootSection[];
}

const BOTH_SIDES: readonly FoldSide[] = ['positive', 'negative'];

/** The line a tool asks a root's layers at: the root through the scene and back. */
export function rootSectionLine(viewTransform: FoldIsometry, root: FoldModelLine): FoldModelLine {
  return modelLineOf(viewTransform, sceneLineOf(viewTransform, root));
}

export function axiomRootsWithSections(
  calls: Pick<FoldEngineCalls, 'axiomCandidates' | 'crossSection'>,
  state: number,
  line: FoldAxiomLine,
  hint: FoldRootSectionHint | null
): FoldRootsAnswered {
  const candidates = calls.axiomCandidates(state, line);
  if (candidates.status !== 'ok' || !hint) return { candidates, sections: [] };
  const root = candidates.candidates[hint.root] ?? candidates.candidates[0];
  if (!root) return { candidates, sections: [] };
  const at = rootSectionLine(hint.viewTransform, root.line);
  const sides =
    root.side === null ? BOTH_SIDES : [hint.swapped ? (root.side === 'positive' ? 'negative' : 'positive') : root.side];
  return {
    candidates,
    sections: sides.map((side) => ({ line: at, side, section: foldEngineAnswer(() => calls.crossSection(state, at, side)) })),
  };
}
