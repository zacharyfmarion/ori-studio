import { locatePleatFirst } from './pleat/pleatStep';
/**
 * What a fold along a line takes by default (owner request, 2026-10-13): the
 * topmost flap at the line as the front shows it — the flap that owns the
 * top row of the cross-section on the moving side — not every layer.
 *
 * The tools hold the default as a seed of its own (`FOLD_TOP_FLAP`), which
 * names no flap: which flap is on top is the section's to say, and a section
 * is a line's and a side's. So the section is asked as soon as the picks
 * locate the line, from the line and side they locate (`lineSectionProbe`;
 * once per line and side, plan D14 tier 2), and the seed is resolved against
 * it there (`useFoldLineSection`) before any step is built. The preview, the
 * chips pressed, the "n of m layers moving" line and the op committed all
 * read that one resolved seed: the top flap's, stored as any flaps seed is
 * (`{ scope: 'flaps', at }`), or every layer when the moving side is that one
 * flap, stored as it always was. Nothing new is stored.
 *
 * The folds that take the top flap are those that fold one flap over: a
 * valley, a mountain (the same flap, the top as the front shows it, folded
 * behind), a precrease of any extent, and a tuck, a plain fold slid under or
 * over a layer. A reverse fold, a crimp and a sink default to every layer
 * at the line (`seedForTool`). For a reverse fold, an Axiom 2 moving point
 * picked on the CP instead names its material flap (`reverseMaterialSeed`),
 * and a free line or an Axiom 1 line every layer on the stretch drawn
 * between its two picks (`reverseSegmentSeed`).
 *
 * Pure: no React, no store, no engine.
 */
import type { FoldModelLine } from '../document/foldSequenceDocument';
import type { FoldAxiomCandidate, FoldCrossSection, FoldSide } from '../engine/foldEngineWire';
import { modelLineOf } from '../canvas/foldCanvasGeometry';
import type { FoldPickIndex } from '../canvas/foldPicking';
import { topFlapOf } from './crossSection';
import { isFoldKind, type FoldToolId } from './foldToolCatalog';
import { locateAlongLine } from './foldStepBuilder';
import { reverseMaterialPoint } from './reverse/reverseMaterialSeed';
import { reverseDrawnSegment } from './reverse/reverseSegmentSeed';
import {
  FOLD_EVERY_LAYER,
  flapSeed,
  type FoldResolvedSeed,
  type FoldToolSeed,
  type FoldToolState,
} from './foldToolState';

/** Whether the tool folds one flap over, so takes the top flap by default; otherwise every layer. */
export function takesTopFlap(tool: FoldToolId): boolean {
  return isFoldKind(tool) || tool === 'tuck' || tool === 'pleat';
}

/**
 * The seed the tool asks for: the tools' own, but the default — the top
 * flap — is every layer for a fold that takes a whole point. Kept apart from
 * the tools' state, so moving along one line from a valley fold to a reverse
 * fold and back gives each its own default.
 */
export function seedForTool(tool: FoldToolId, seed: FoldToolSeed): FoldToolSeed {
  return seed.scope === 'top' && !takesTopFlap(tool) ? FOLD_EVERY_LAYER : seed;
}

/**
 * The top flap at the line as a seed (`topFlapOf`): that flap, or every
 * layer when it is the only flap on the moving side, or the section has
 * none to name.
 */
export function topFlapSeed(section: FoldCrossSection): FoldResolvedSeed {
  const top = topFlapOf(section);
  const flap = top === null ? undefined : section.flaps[top];
  return flap ? flapSeed([flap], section.flaps) : FOLD_EVERY_LAYER;
}

/** A line and the side that moves, as a key: one section each. */
export function lineSideKeyOf(sceneLine: FoldModelLine, movingSign: 1 | -1): string {
  return `${sceneLine.n[0]},${sceneLine.n[1]},${sceneLine.d}:${movingSign}`;
}

/** The line the picks locate and the side that moves, as the cross-section is asked for them. */
export interface FoldLineSectionProbe {
  /** The line in the scene frame and the moving side, as `lineSideKeyOf` names them. */
  key: string;
  /** The line in the model frame, as the engine takes it (it snaps it as a fold would). */
  line: FoldModelLine;
  side: FoldSide;
}

/** What the probe reads of the tools: the tool, the picks and the choices of line and side. */
export type FoldLineSectionTools = Pick<FoldToolState, 'tool' | 'lineMode' | 'picks' | 'swapped' | 'override'> & { secondLineMode?: FoldToolState['secondLineMode'] };

/**
 * The line and side the picks locate, for a fold that takes the top flap,
 * a reverse fold naming material on the CP, or a reverse fold drawn between
 * two picks: what its section is asked for, before any step is built.
 * Null when there is none to ask for: another tool; a fix's line folded in
 * place of the picks' (its section comes with its analysis); a line not yet
 * located, or refused before the engine is asked; or a bend being unfolded,
 * whose flap the step builder takes beside the bend (plan D3) — the top flap
 * hinged on it.
 *
 * The side is the one the step will fold: located as the step locates it,
 * with every layer, which names the same line and side as any seed.
 */
export function lineSectionProbe(
  tools: FoldLineSectionTools,
  index: FoldPickIndex,
  candidate: FoldAxiomCandidate | null,
  secondCandidate: FoldAxiomCandidate | null = null
): FoldLineSectionProbe | null {
  const { tool, lineMode, picks, swapped, override } = tools;
  if ((!takesTopFlap(tool) && reverseMaterialPoint(tools) === null && reverseDrawnSegment(tools) === null) || override) return null;
  // A valley or mountain along a bend unfolds it; a precrease or a tuck never does.
  const unfolds = tool === 'valley' || tool === 'mountain';
  const intent = { lineMode, picks, candidate, swapped, seed: FOLD_EVERY_LAYER };
  const located = tool === 'pleat' ? locatePleatFirst({ ...intent, secondCandidate, secondLineMode: tools.secondLineMode ?? 'free' }, index) : locateAlongLine(intent, index, unfolds);
  if ('status' in located || located.unfolding) return null;
  const { sceneLine, movingSign } = located;
  return {
    key: lineSideKeyOf(sceneLine, movingSign),
    // The view turns the model's line and side alike: the side is the same sign against either.
    line: modelLineOf(index.scene.view_transform, sceneLine),
    side: movingSign === 1 ? 'positive' : 'negative',
  };
}
